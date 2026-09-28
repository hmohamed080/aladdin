"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  createCraftsmanPasswordUser,
  deleteCraftsmanPasswordUser,
  isCanonicalPhoneTaken,
} from "@/lib/supabase/admin-server";
import { craftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { clientIpFrom, verifyTurnstileToken } from "@/server/auth/turnstile";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import { hasAppAccess, type RegistrationState } from "@/server/queries/registration";
import { checkNewPassword, parseFullName, parsePhone } from "@/features/installer-phone-auth/validation";
import { generateCraftsmanUsername } from "@/features/installer-phone-auth/username";
import type { Database } from "@/types/database.types";

/**
 * Installer/technician phone + password entry point (approved, role-specific)
 * (docs/frontend/installer-phone-auth.md). A parallel ENTRY POINT only —
 * it creates an ordinary account through the existing infrastructure and
 * hands it to the existing installer experience:
 *
 *   phone + password
 *     → canonical E.164 (lib/contact/phone.ts)
 *     → internal login alias (lib/auth/craftsman-login-alias.ts)
 *     → Supabase Auth user, password hashed by GoTrue      (service role, once)
 *     → normal cookie session via signInWithPassword         (caller's client)
 *     → record_consent · onboarding_select_account_type(professional,
 *       installer_technician) · profile_set_phone · profile_set_username
 *       — the SAME RPCs, as the SAME authenticated caller, the canonical
 *       registration uses
 *     → my_registration_state() must be access_ready
 *     → resolveActiveLanding() (/home for an installer)
 *
 * The one intentional bypass is that no OTP is sent. Everything else holds:
 * Turnstile on sign-up, the existing password policy, GoTrue's own password
 * storage and rate limits, RLS on every write after the account exists.
 *
 * ROLLBACK: if anything after the Auth user is created fails, the session is
 * dropped and that user is deleted (the identity rows cascade), so a failed
 * sign-up never leaves an account that exists but cannot be used.
 *
 * Nothing here logs a phone, alias, password, token, or session.
 * Not wired to `/auth/*` or `server/actions/auth.ts`, which stay unchanged.
 */

export type CraftsmanField = "name" | "phone" | "password" | "consent" | "captcha" | "form";

export type CraftsmanAuthState = {
  ok: boolean;
  /** Translation key (temporaryCraftsman.*). */
  code?: string;
  /** Which field the message belongs to, for inline placement. */
  field?: CraftsmanField;
  /** Values echoed back so a failed submit does not clear the form. NEVER the password. */
  values?: { name?: string; phone?: string };
};

const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const USERNAME_ATTEMPTS = 5;
type Client = SupabaseClient<Database>;

function fail(code: string, field: CraftsmanField, values?: CraftsmanAuthState["values"]): CraftsmanAuthState {
  return { ok: false, code: `temporaryCraftsman.error.${code}`, field, values };
}

function isRateLimited(error: { code?: string; status?: number }): boolean {
  return error.status === 429 || (error.code ?? "").startsWith("over_");
}

/** Safe diagnostics only: the step and a Postgres/GoTrue error code. */
function logStepFailure(step: string, error: { code?: string } | null | undefined): void {
  console.error(`installer phone sign-up: ${step} failed (code ${error?.code ?? "unknown"})`);
}

class InitializationError extends Error {
  constructor(readonly outcome: "phone_taken" | "failed") {
    super(outcome);
  }
}

/**
 * Initializes the just-created account AS ITS OWN AUTHENTICATED CALLER through
 * the canonical RPCs. Throws `InitializationError` on the first failure.
 */
async function initializeCraftsmanAccount(
  supabase: Client,
  phone: { countryIso2: string; national: string; e164: string },
): Promise<void> {
  const { error: consentError } = await supabase.rpc("record_consent", {
    p_types: [...CONSENT_TYPES],
    p_locale: "ar",
  });
  if (consentError) {
    logStepFailure("consent", consentError);
    throw new InitializationError("failed");
  }

  const { error: typeError } = await supabase.rpc("onboarding_select_account_type", {
    p_track: "professional",
    p_account_type: "installer_technician",
  });
  if (typeError) {
    logStepFailure("account_type", typeError);
    throw new InitializationError("failed");
  }

  // Authoritative phone claim — the unique index is the final word if another
  // account took this number after the pre-check (23505).
  const { error: phoneError } = await supabase.rpc("profile_set_phone", {
    p_country_iso2: phone.countryIso2,
    p_national: phone.national,
    p_e164: phone.e164,
  });
  if (phoneError) {
    if (phoneError.code === "23505") throw new InitializationError("phone_taken");
    logStepFailure("phone", phoneError);
    throw new InitializationError("failed");
  }

  let usernameSet = false;
  for (let attempt = 0; attempt < USERNAME_ATTEMPTS && !usernameSet; attempt += 1) {
    const { error } = await supabase.rpc("profile_set_username", { p_username: generateCraftsmanUsername() });
    if (!error) usernameSet = true;
    else if (error.code !== "23505") {
      logStepFailure("username", error);
      throw new InitializationError("failed");
    }
  }
  if (!usernameSet) {
    logStepFailure("username", { code: "exhausted" });
    throw new InitializationError("failed");
  }

  const { data: state, error: stateError } = await supabase.rpc("my_registration_state");
  if (stateError || !hasAppAccess(state as RegistrationState)) {
    logStepFailure("registration_state", stateError ?? { code: String(state) });
    throw new InitializationError("failed");
  }
}

// ---------------------------------------------------------------------------
// Sign up — full name + phone + password + consent (+ Turnstile). No OTP.
// ---------------------------------------------------------------------------
export async function craftsmanSignUp(_prev: CraftsmanAuthState, formData: FormData): Promise<CraftsmanAuthState> {
  const rawName = typeof formData.get("name") === "string" ? String(formData.get("name")) : "";
  const rawPhone = typeof formData.get("phone") === "string" ? String(formData.get("phone")) : "";
  const values = { name: rawName, phone: rawPhone };

  const name = parseFullName(rawName);
  if (!name.ok) return { ok: false, code: name.code, field: "name", values };
  const phone = parsePhone(rawPhone);
  if (!phone.ok) return { ok: false, code: phone.code, field: "phone", values };
  const password = checkNewPassword(formData.get("password"), { phone: phone.value, name: name.value });
  if (!password.ok) return { ok: false, code: password.code, field: "password", values };
  if (formData.get("consent") !== "on") return fail("consentRequired", "consent", values);

  const h = await headers();
  const captcha = await verifyTurnstileToken(formData.get("captchaToken"), {
    remoteIp: clientIpFrom((headerName) => h.get(headerName)),
  });
  if (!captcha.ok) return fail(captcha.reason === "missing" ? "captchaRequired" : "captchaRejected", "captcha", values);

  // Duplicate phone — across EVERY account (an email-registered user who saved
  // this number included), then again atomically at createUser (alias) and at
  // profile_set_phone (unique index). Product decision: say so plainly.
  try {
    if (await isCanonicalPhoneTaken(phone.value.e164)) return fail("phoneExists", "phone", values);
  } catch (error) {
    logStepFailure("phone_precheck", error as { code?: string });
    return fail("signUpFailed", "form", values);
  }

  const loginAlias = craftsmanLoginAlias(phone.value.e164);
  const created = await createCraftsmanPasswordUser({
    loginAlias,
    password: password.value,
    fullName: name.value,
  });
  if (!created.ok) {
    if (created.reason === "exists") return fail("phoneExists", "phone", values);
    if (created.reason === "rate_limited") return fail("rateLimited", "form", values);
    if (created.reason === "rejected") return fail("passwordRejected", "password", values);
    return fail("signUpFailed", "form", values);
  }

  const supabase = await getServerSupabase();
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginAlias,
      password: password.value,
    });
    if (signInError) {
      logStepFailure("session", signInError as { code?: string });
      throw new InitializationError("failed");
    }
    await initializeCraftsmanAccount(supabase, phone.value);
  } catch (error) {
    // ROLLBACK — drop the session cookies, then delete the account this call
    // just created. `deleteUser` cascades to public.users/profiles and every
    // row the steps above wrote.
    await supabase.auth.signOut({ scope: "local" });
    await deleteCraftsmanPasswordUser(created.userId);
    if (error instanceof InitializationError && error.outcome === "phone_taken") {
      return fail("phoneExists", "phone", values);
    }
    if (!(error instanceof InitializationError)) logStepFailure("initialization", error as { code?: string });
    return fail("signUpFailed", "form", values);
  }

  redirect(await resolveActiveLanding(supabase));
}

// ---------------------------------------------------------------------------
// Sign in — phone + password. One generic message for every credential
// failure (unknown number, wrong password, disabled account).
// ---------------------------------------------------------------------------
export async function craftsmanSignIn(_prev: CraftsmanAuthState, formData: FormData): Promise<CraftsmanAuthState> {
  const rawPhone = typeof formData.get("phone") === "string" ? String(formData.get("phone")) : "";
  const values = { phone: rawPhone };
  const phone = parsePhone(rawPhone);
  if (!phone.ok) return { ok: false, code: phone.code, field: "phone", values };
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) return fail("passwordRequired", "password", values);

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: craftsmanLoginAlias(phone.value.e164),
    password,
  });
  if (error) {
    if (isRateLimited(error as { code?: string; status?: number })) return fail("rateLimited", "form", values);
    return fail("invalidCredentials", "form", values);
  }

  // The SAME post-session rule as the shared email sign-in (verifyEmailOtp):
  // `next` is re-validated server-side (sanitizeNext: same-origin allow-list,
  // never `//host` or an absolute URL), onboarding/invitation continuations keep
  // their handoff, everything else passes the registration gate, and a deep
  // link survives only when it belongs to the caller's own landing surface.
  const next = sanitizeNext(formData.get("next"));
  if (next.startsWith("/onboarding") || next.startsWith("/auth/invite/")) redirect(next);

  const { data: state } = await supabase.rpc("my_registration_state");
  if (!hasAppAccess(state as RegistrationState)) redirect("/onboarding");
  const landing = await resolveActiveLanding(supabase);
  redirect(next === landing || next.startsWith(`${landing}/`) ? next : landing);
}
