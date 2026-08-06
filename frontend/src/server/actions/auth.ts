"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { sanitizeNext } from "@/server/auth/next";

/**
 * Passwordless Email-OTP account access (Supabase Auth). Two steps: request a
 * one-time code, then verify it. No passwords, no SMS, no service-role. Phone /
 * WhatsApp OTP is a future integration sprint. Actions return a small
 * `{ ok, code }` result whose `code` is a translation key the client renders in
 * the active locale.
 *
 * Sign In and Sign Up are DISTINCT: Sign In never creates a user
 * (`shouldCreateUser: false`); Sign Up may (`shouldCreateUser: true`) and records
 * the accepted consent after verification. Neither exposes whether an email
 * already exists before a code is successfully verified (anti-enumeration).
 */

export type AuthState = { ok: boolean; code?: string; email?: string };

const emailSchema = z.string().trim().email();
const otpSchema = z.string().trim().regex(/^\d{6}$/);
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;

/**
 * True when GoTrue rejected the OTP send because the email is not an existing
 * identity (Sign In runs with `shouldCreateUser: false`, so unknown emails are
 * refused). We treat this like a successful send so the response is identical
 * for known and unknown emails — Sign In must not become an account-enumeration
 * oracle, and it must never silently register a new user.
 */
function isUnknownIdentityError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    /signups?\s+not\s+allowed/.test(message) ||
    /user\s+not\s+found/.test(message)
  );
}

/**
 * Step 1 — send a 6-digit code to the email.
 *
 * This is SIGN IN, not registration: `shouldCreateUser: false` means an unknown
 * email never creates an `auth.users` row. Registration / invitation is a
 * separate, reviewed workflow (professional/business activation is not bypassed
 * here). The caller-visible result is the same whether or not the email exists.
 */
export async function requestEmailOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, code: "auth.error.invalidEmail" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false },
  });
  if (error) {
    // Unknown identity → indistinguishable "code sent" response (no enumeration,
    // no implicit sign-up). Only genuine transient failures surface an error.
    if (isUnknownIdentityError(error as { code?: string; message?: string })) {
      return { ok: true, code: "auth.info.codeSent", email: parsed.data };
    }
    return { ok: false, code: "auth.error.sendFailed", email: parsed.data };
  }
  return { ok: true, code: "auth.info.codeSent", email: parsed.data };
}

/** Step 2 — verify the code, establish the session cookie, and continue. */
export async function verifyEmailOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const token = otpSchema.safeParse(formData.get("token"));
  if (!email.success) return { ok: false, code: "auth.error.invalidEmail" };
  if (!token.success) return { ok: false, code: "auth.error.invalidCode", email: email.data };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: token.data,
    type: "email",
  });
  if (error) return { ok: false, code: "auth.error.verifyFailed", email: email.data };

  redirect(sanitizeNext(formData.get("next")));
}

/**
 * SIGN UP — step 1. Sends a code with `shouldCreateUser: true` so a new identity
 * can be created on verification (the DB trigger bootstraps profile rows). The
 * three required consents (Terms / Privacy / Pilot) must all be accepted before a
 * code is sent; they are re-checked here server-side, never trusted from the UI
 * alone. An already-registered email simply receives a sign-in code — the response
 * is identical either way, so Sign Up never reveals whether an email exists.
 */
export async function requestSignUpOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, code: "auth.error.invalidEmail" };

  const consented = CONSENT_TYPES.every((t) => formData.get(`consent_${t}`) === "on");
  if (!consented) return { ok: false, code: "auth.error.consentRequired", email: parsed.data };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, code: "auth.error.sendFailed", email: parsed.data };
  return { ok: true, code: "auth.info.codeSent", email: parsed.data };
}

/**
 * SIGN UP — step 2. Verify the code (creating the identity), then persist the
 * consent receipt in the active locale via the trusted `record_consent` RPC and
 * hand off to `/onboarding`. Consent is required to have reached this step, so we
 * record it unconditionally; a transient RPC failure still lands the user on
 * `/onboarding`, which will surface any outstanding consent step.
 */
export async function verifySignUpOtp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const token = otpSchema.safeParse(formData.get("token"));
  if (!email.success) return { ok: false, code: "auth.error.invalidEmail" };
  if (!token.success) return { ok: false, code: "auth.error.invalidCode", email: email.data };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    email: email.data,
    token: token.data,
    type: "email",
  });
  if (error) return { ok: false, code: "auth.error.verifyFailed", email: email.data };

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // Best-effort: never block the verified session on a consent-write hiccup —
  // /onboarding re-derives state and can re-request consent if this failed.
  await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });

  redirect("/onboarding");
}

/** Sign out and return to the sign-in screen. */
export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
