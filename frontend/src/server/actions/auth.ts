"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import { hasAppAccess, type RegistrationState } from "@/server/queries/registration";
import { isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";

/**
 * One-time email codes (Supabase Auth), used by the Forgot Password recovery
 * and by `/auth/verify`. Request a code, then verify it. No SMS, no
 * service-role. Sign-in and sign-up with a password live in
 * `auth-password-preview.ts`; nothing here creates a user
 * (`shouldCreateUser: false`) and neither step reveals whether an email
 * already exists before a code is successfully verified (anti-enumeration).
 * Actions return a small `{ ok, code }` result whose `code` is a translation
 * key the client renders in the active locale.
 */

export type AuthState = { ok: boolean; code?: string; email?: string };

const emailSchema = z.string().trim().email();
const otpSchema = z.string().trim().regex(/^\d{6}$/);

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
 * True when GoTrue rejected an OTP *send* specifically for rate limiting
 * (`over_email_send_rate_limit`, documented at
 * supabase.com/docs/guides/auth/debugging/error-codes) rather than a generic
 * transient failure.
 */
function isSendRateLimitError(error: { code?: string }): boolean {
  return error.code === "over_email_send_rate_limit";
}

/**
 * Maps a `verifyOtp` failure to the most specific translation key GoTrue's
 * error code actually supports. Only `otp_expired` and `over_request_rate_limit`
 * are distinct, documented codes — everything else (including a genuinely
 * wrong code) collapses to one generic message, because GoTrue does not expose
 * a separate code for "wrong" vs. other invalid-token cases. Do not invent a
 * finer distinction the backend doesn't actually provide.
 */
function verifyFailureCode(error: { code?: string }): string {
  if (error.code === "otp_expired") return "auth.error.otpExpired";
  if (error.code === "over_request_rate_limit") return "auth.error.rateLimited";
  return "auth.error.verifyFailed";
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

  // GoTrue protects every OTP send with CAPTCHA when `[auth.captcha]` is on:
  // the token is forwarded for GoTrue to judge (never also verified here).
  const captchaToken = captchaTokenFrom(formData);
  if (!captchaToken) return { ok: false, code: "auth.error.captchaRequired", email: parsed.data };

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, captchaToken },
  });
  if (error) {
    if (isCaptchaFailure(error as { code?: string; message?: string })) {
      return { ok: false, code: "auth.error.captchaRejected", email: parsed.data };
    }
    // Unknown identity → indistinguishable "code sent" response (no enumeration,
    // no implicit sign-up). Only genuine transient failures surface an error.
    if (isUnknownIdentityError(error as { code?: string; message?: string })) {
      return { ok: true, code: "auth.info.codeSent", email: parsed.data };
    }
    if (isSendRateLimitError(error as { code?: string })) {
      return { ok: false, code: "auth.error.rateLimited", email: parsed.data };
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
  if (error) return { ok: false, code: verifyFailureCode(error as { code?: string }), email: email.data };

  const next = sanitizeNext(formData.get("next"));

  // Registration and invitation continuations keep their existing handoff. They
  // must remain reachable before the account becomes active.
  if (next.startsWith("/onboarding") || next.startsWith("/auth/invite/")) {
    redirect(next);
  }

  // Every other successful sign-in passes through the registration gate first.
  // An indeterminate state is safest at /onboarding, whose route re-derives the
  // exact pending step; it must never fall through into an active surface.
  const { data: state } = await supabase.rpc("my_registration_state");
  if (!hasAppAccess(state as RegistrationState)) redirect("/onboarding");

  // This is the real post-OTP landing path. Resolve the caller's canonical
  // surface, then retain a safe deep link only when it belongs to that surface.
  const landing = await resolveActiveLanding(supabase);
  const destination = next === landing || next.startsWith(`${landing}/`) ? next : landing;
  redirect(destination);
}

/**
 * Sign out and return to the sign-in screen THIS account can use. The identity
 * is read before the session ends — a known fact about the caller, not a guess:
 * an installer phone + password account (internal login alias,
 * lib/auth/craftsman-login-alias.ts) cannot sign in on the email page, so it
 * returns to /installer/sign-in; every other account returns to /auth/sign-in
 * exactly as before.
 */
export async function signOut(): Promise<void> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  // Registration source selects an entry page only; it never grants authority.
  const phoneEntry = user?.app_metadata?.registration_source === "temporary_showroom_password_flow" ? "/showroom/sign-in" : "/installer/sign-in";
  redirect(isCraftsmanLoginAlias(user?.email) ? phoneEntry : "/auth/sign-in");
}
