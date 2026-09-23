"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { markPasswordAttachedAuthoritatively, PASSWORD_SET_FLAG } from "@/lib/supabase/admin-server";
import {
  createIsolatedAuthClient,
  encryptRecoveryGrant,
  decryptRecoveryGrant,
  RECOVERY_GRANT_TTL_SECONDS,
} from "@/lib/supabase/recovery-grant";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import type { Database } from "@/types/database.types";
import {
  emailSchema,
  registrationSchema,
  passwordWithContextSchema,
} from "@/features/auth-password-preview/password-policy";

/**
 * ISOLATED PREVIEW server actions for password-based registration/sign-in
 * (docs/frontend/auth-password-preview.md). NOT wired to the canonical
 * `/auth/*` routes or `server/actions/auth.ts` — this file exists so the new
 * flow can be reviewed end-to-end before promotion. It deliberately reuses the
 * same primitives production auth already uses (`getServerSupabase`,
 * `sanitizeNext`, `resolveActiveLanding`, `my_registration_state`) rather than
 * inventing a parallel session/authorization model; only the credential
 * mechanism (password instead of a second OTP round-trip) is new.
 *
 * REGISTRATION ARCHITECTURE DECISION (revision 2): the OTP-first design is
 * KEPT, not replaced with `signUp()`-first. Empirically tested locally:
 * flipping `enable_confirmations=true` (required for `signUp()` to withhold a
 * session until confirmed) changes which GoTrue email TEMPLATE the existing
 * production passwordless Sign Up uses for `shouldCreateUser:true` — from
 * `magic_link` (customized locally to show the 6-digit `{{.Token}}`) to
 * `confirmation` (link-only by default, no code). That would silently break
 * the existing OTP-code UI's "enter the 6-digit code" step for EVERY
 * passwordless registration, project-wide, the moment the setting changes —
 * `enable_confirmations` is a single global project setting, not scoped per
 * flow. Promoting to `signUp()`-first later remains viable, but requires
 * ALSO customizing the `confirmation` template (locally AND on the hosted
 * dashboard) and re-running the full existing passwordless test/e2e suite
 * first — not something an isolated preview should do unilaterally. See
 * docs/frontend/auth-password-preview.md §Registration architecture for the
 * full investigation record.
 *
 * Because OTP-first remains, the interrupted-state window between a
 * successful `verifyOtp` (email confirmed, session exists) and the
 * `updateUser({password})` call that follows it is real (a dropped
 * connection, a crashed tab). This is closed by stamping the AUTHORITATIVE
 * `app_metadata.aladdin_pw_preview_password_set` flag (REVISION 3: via
 * `markPasswordAttachedAuthoritatively`, `lib/supabase/admin-server.ts` — a
 * service-role write, NOT `user_metadata`, which any signed-in caller can
 * forge on their own account) right after `updateUser` sets the password,
 * and `resumePasswordSignUpEmail()` (called from the sign-up page) detects a
 * signed-in session that is missing that flag and routes straight to the
 * password-only completion step (`finishPasswordSignUp`) — no new code, no
 * lost verification.
 *
 * Recovery follows the same OTP-native pattern: `resetPasswordForEmail`
 * sends a 6-digit code (not a magic link). REVISION 3: `verifyOtp({type:
 * "recovery"})` now runs on an ISOLATED, non-cookie-backed client
 * (`createIsolatedAuthClient`) — its resulting session is NEVER persisted
 * into the app's normal Supabase session cookies at all, closing the gap
 * revision 2 only partly closed (a plain marker cookie gated the UI, but a
 * fully-privileged session still existed in the real cookies the whole time).
 * The verified session's access AND refresh tokens are sealed into an
 * encrypted `pwr_grant` cookie (`lib/supabase/recovery-grant.ts`) instead —
 * both, because GoTrue SDK auth methods (`updateUser`, `signOut`) read the
 * CALLING CLIENT's own in-memory session via `setSession`/`_useSession`, not
 * a bare `Authorization` header. Screen 3's one `updateUser` call
 * authenticates by hydrating a FRESH, non-persisting isolated client with
 * `setSession({access_token, refresh_token})` from the grant (never the
 * cookie-backed client), then ends every session for that user on that same
 * hydrated client (global sign-out) and deletes the grant.
 * `features/auth-password-preview/recovery-session.ts`'s `amr` decoder
 * remains a documented negative result (GoTrue's `amr` does not distinguish
 * a recovery OTP from a normal one — empirically verified) — it was never a
 * viable gate, which is *why* isolation had to be architectural rather than
 * a check on the session.
 */

export type PasswordAuthState = { ok: boolean; code?: string; email?: string };

const otpSchema = /^\d{6}$/;
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;

// PASSWORD_SET_FLAG imported from admin-server.ts below — it is the single source of truth for the flag name,
// shared with the ONLY code path allowed to write it (see that file's doc comment).

/** Recovery-flow UX cookies. NEVER the OTP or password — only routing state. See docs/frontend/auth-password-preview.md §Forgot password screens. */
const RECOVERY_EMAIL_COOKIE = "pwr_email";
const RECOVERY_SUCCESS_COOKIE = "pwr_success";
/**
 * The recovery-grant cookie (`lib/supabase/recovery-grant.ts`) — an
 * AES-256-GCM-encrypted blob, not a boolean flag. Revision 2 of this preview
 * gated Screen 3 on a plain `"1"` marker cookie set after `verifyOtp`
 * succeeded on the NORMAL cookie-backed client — which meant a fully
 * privileged Supabase session was, in fact, established in the app's real
 * session cookies for the whole window between Screen 2 and Screen 3.
 * Revision 3 closes that: `verifyRecoveryCode` now runs `verifyOtp` on an
 * ISOLATED, non-persisting client (`createIsolatedAuthClient`) whose result
 * never touches `getServerSupabase()`'s cookies at all, and seals only the
 * resulting access token into this cookie. The normal app middleware and the
 * normal Supabase client never see or interpret it — there is no session for
 * them to see. See docs/frontend/auth-password-preview.md
 * §Recovery-session isolation for the full design and the explicit
 * `/b2b`/`/admin`/RLS-denial tests.
 */
const RECOVERY_GRANT_COOKIE = "pwr_grant";
const RECOVERY_FLOW_PATH = "/preview/auth-password/forgot-password";
/** UX target ~10 minutes (§7) — Supabase's own `otp_expiry` is a single project-wide value shared with the existing
 * passwordless flow's OTP (currently 3600s) and cannot be scoped per-type in `supabase/config.toml`; this cookie
 * lifetime (and the "may be stale" hint it drives) is an application-level UX target, not a security boundary —
 * the code remains cryptographically valid per Supabase's own expiry until that fires. See docs/frontend/auth-password-preview.md §OTP security. */
const RECOVERY_COOKIE_MAX_AGE_SECONDS = 600;
type GoTrueError = { code?: string; status?: number; message?: string };

function isRateLimitError(error: GoTrueError): boolean {
  return (
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_sms_send_rate_limit" ||
    error.status === 429
  );
}

/**
 * GoTrue's own captcha-verification failure — a rejected/expired/spent
 * Turnstile token. Matches on `code` only (not a generic status, since 422 is
 * shared with unrelated errors like "user already registered" — see
 * docs/frontend/auth-password-preview.md §Registration architecture's
 * enumeration finding).
 */
function isCaptchaError(error: GoTrueError): boolean {
  return error.code === "captcha_failed";
}

/** Maps a `verifyOtp` failure to GoTrue's own documented codes; anything else stays generic. */
function verifyFailureCode(error: GoTrueError): string {
  if (error.code === "otp_expired") return "authPasswordPreview.error.otpExpired";
  if (isRateLimitError(error)) return "authPasswordPreview.error.rateLimited";
  return "authPasswordPreview.error.verifyFailed";
}

/** A weak-password schema rejection message, else the generic GoTrue-side rejection code (defense in depth). Call only after narrowing to the failed branch (`!parsed.success`). */
function passwordIssueCode(parsed: { success: false; error: { issues: { message: string }[] } }): string {
  return (parsed.error.issues[0]?.message as string) ?? "authPasswordPreview.error.passwordTooShort";
}

function passwordSetFailureCode(error: GoTrueError): string {
  if (isRateLimitError(error)) return "authPasswordPreview.error.rateLimited";
  return "authPasswordPreview.error.passwordRejected";
}

/** Absolute URL on the CURRENT request's own origin — never a caller-supplied value. */
async function absoluteUrl(path: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}

/**
 * The same post-session redirect chain `verifyEmailOtp` uses in production
 * (registration/invitation continuation → registration-state gate → derived
 * landing). Duplicated here rather than imported/extracted: this file is an
 * unreviewed preview and must not change the production action module's
 * shape. Promotion to the canonical flow should fold this back into one
 * shared helper (see docs/frontend/auth-password-preview.md).
 */
async function postSessionRedirect(supabase: SupabaseClient<Database>, next: string): Promise<never> {
  if (next.startsWith("/onboarding") || next.startsWith("/auth/invite/")) {
    redirect(next);
  }
  const { data: state } = await supabase.rpc("my_registration_state");
  if (state !== "active_personal") redirect("/onboarding");

  const landing = await resolveActiveLanding(supabase);
  const destination = next === landing || next.startsWith(`${landing}/`) ? next : landing;
  redirect(destination);
}

// ---------------------------------------------------------------------------
// Registration — step 1: collect email + password, send the email-verify code.
// ---------------------------------------------------------------------------
export async function requestPasswordSignUp(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const parsed = registrationSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: (first?.message as string) ?? "authPasswordPreview.error.invalidEmail" };
  }

  const consented = CONSENT_TYPES.every((type) => formData.get(`consent_${type}`) === "on");
  if (!consented) {
    return { ok: false, code: "authPasswordPreview.error.consentRequired", email: parsed.data.email };
  }

  const captchaToken = formData.get("captchaToken");
  if (typeof captchaToken !== "string" || captchaToken.length === 0) {
    return { ok: false, code: "authPasswordPreview.error.captchaRequired", email: parsed.data.email };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, captchaToken },
  });
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited", email: parsed.data.email };
    }
    if (isCaptchaError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.captchaRejected", email: parsed.data.email };
    }
    return { ok: false, code: "authPasswordPreview.error.sendFailed", email: parsed.data.email };
  }
  return { ok: true, code: "authPasswordPreview.info.codeSent", email: parsed.data.email };
}

// ---------------------------------------------------------------------------
// Registration — step 2: verify the code (confirms the email), then attach
// the password to the now-confirmed identity.
// ---------------------------------------------------------------------------
export async function verifyPasswordSignUp(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const token = formData.get("token");
  if (!email.success) return { ok: false, code: "authPasswordPreview.error.invalidEmail" };
  if (typeof token !== "string" || !otpSchema.test(token)) {
    return { ok: false, code: "authPasswordPreview.error.invalidCode", email: email.data };
  }
  const password = passwordWithContextSchema([email.data]).safeParse(formData.get("password"));
  if (!password.success) {
    return { ok: false, code: passwordIssueCode(password), email: email.data };
  }

  const supabase = await getServerSupabase();
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    email: email.data,
    token,
    type: "email",
  });
  if (verifyError || !verifyData.user) {
    return { ok: false, code: verifyFailureCode((verifyError ?? {}) as GoTrueError), email: email.data };
  }

  // The identity is now confirmed and a session exists. Attach the password —
  // if GoTrue's own policy rejects it (defense in depth; the client already
  // enforced the same policy) or the request never completes, the caller
  // keeps the confirmed session and `resumePasswordSignUp()`/
  // `finishPasswordSignUp` recover it without re-verifying the code (see the
  // module doc comment).
  const { error: passwordError } = await supabase.auth.updateUser({ password: password.data });
  if (passwordError) {
    return { ok: false, code: passwordSetFailureCode(passwordError as GoTrueError), email: email.data };
  }

  // Authoritative, server-controlled stamp — NOT user_metadata (see the
  // module doc comment and `lib/supabase/admin-server.ts`). A separate call
  // from `updateUser` above, so this IS itself a second, narrower
  // interruption window (password attached, flag not yet stamped) — see
  // `resumePasswordSignUpEmail`'s doc comment for how that's handled safely.
  await markPasswordAttachedAuthoritatively(verifyData.user.id);

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // Best-effort, matches production sign-up: never block a verified+credentialed
  // session on a consent-write hiccup.
  await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });

  return postSessionRedirect(supabase, "/onboarding");
}

/**
 * Interrupted-state check for the sign-up PAGE (Server Component): a signed-in
 * session whose email is confirmed but never got the `PASSWORD_SET_FLAG`
 * stamp means `verifyPasswordSignUp` succeeded at the OTP step but never
 * completed `updateUser` (dropped connection, crashed tab, etc.). Returns the
 * email to resume with, or `null` when there is nothing to resume (no
 * session, or the session already has a password).
 */
export async function resumePasswordSignUpEmail(): Promise<string | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  if (user.app_metadata?.[PASSWORD_SET_FLAG] === true) return null;
  return user.email;
}

/**
 * Migration-page guard: is the current caller signed in, and does their
 * account already have a password attached (via any path — sign-up,
 * migration, or a past reset all stamp the same flag)? Distinct from
 * `resumePasswordSignUpEmail`, which is specifically about an INTERRUPTED
 * sign-up — this is the general "does this account have a password"
 * question, asked for an ordinary already-signed-in passwordless user.
 */
export async function migrationEligibility(): Promise<{ email: string; hasPassword: boolean } | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { email: user.email, hasPassword: user.app_metadata?.[PASSWORD_SET_FLAG] === true };
}

/**
 * Fallback retry for the rare case `verifyPasswordSignUp` confirmed the email
 * but GoTrue rejected the password itself, AND the resume path for a
 * genuinely interrupted session (browser/network failure between OTP verify
 * and `updateUser`). Requires the session already established by the OTP
 * step — never re-sends or re-verifies a code.
 */
export async function finishPasswordSignUp(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "authPasswordPreview.error.sessionExpired" };
  }

  const parsed = passwordWithContextSchema([user.email ?? ""]).safeParse(formData.get("password"));
  const confirm = formData.get("confirmPassword");
  if (!parsed.success) {
    return { ok: false, code: passwordIssueCode(parsed) };
  }
  if (parsed.data !== confirm) {
    return { ok: false, code: "authPasswordPreview.error.passwordMismatch" };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    return { ok: false, code: passwordSetFailureCode(error as GoTrueError) };
  }
  await markPasswordAttachedAuthoritatively(user.id);

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });

  return postSessionRedirect(supabase, "/onboarding");
}

// ---------------------------------------------------------------------------
// Sign in — email + password. Anti-enumeration: every failure that is not a
// rate limit returns the SAME generic message, whether the account doesn't
// exist, the password is wrong, the email isn't confirmed, or the account is
// disabled/banned.
// ---------------------------------------------------------------------------
export async function passwordSignIn(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = formData.get("password");
  if (!email.success || typeof password !== "string" || password.length === 0) {
    return { ok: false, code: "authPasswordPreview.error.invalidCredentials" };
  }

  // GoTrue's `[auth.captcha]` toggle is all-or-nothing across
  // signup/recovery/password-grant sign-in — see turnstile-widget.tsx's doc
  // comment. Whatever token the invisible widget produced (possibly none yet,
  // on a very fast submit) is passed through; a resulting `captcha_failed`
  // deliberately falls into the SAME generic bucket below, not a distinct
  // message — Sign In never surfaces "captcha" wording, matching its
  // anti-enumeration policy and staying visually frictionless either way.
  const captchaToken = formData.get("captchaToken");

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password,
    options: typeof captchaToken === "string" && captchaToken.length > 0 ? { captchaToken } : undefined,
  });
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited", email: email.data };
    }
    // Deliberately identical for "no such account", "wrong password", "email
    // not confirmed", "user_banned", AND a missing/invalid captcha token —
    // see the module doc comment and the captcha note just above.
    return { ok: false, code: "authPasswordPreview.error.invalidCredentials", email: email.data };
  }

  const next = sanitizeNext(formData.get("next"));
  return postSessionRedirect(supabase, next);
}

// ---------------------------------------------------------------------------
// Forgot password — Screen 1: request a recovery code. Always the same
// neutral response; the destination-email cookie is set identically whether
// or not the account exists, so navigation behavior cannot leak existence.
// ---------------------------------------------------------------------------
export async function requestRecoveryCode(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, code: "authPasswordPreview.error.invalidEmail" };

  const captchaToken = formData.get("captchaToken");
  if (typeof captchaToken !== "string" || captchaToken.length === 0) {
    return { ok: false, code: "authPasswordPreview.error.captchaRequired", email: email.data };
  }

  const isolated = createIsolatedAuthClient();
  const redirectTo = await absoluteUrl(`${RECOVERY_FLOW_PATH}/reset`);
  const { error } = await isolated.auth.resetPasswordForEmail(email.data, { redirectTo, captchaToken });

  // Rate limiting and a rejected captcha are the only signals allowed to
  // differ (§Forgot-password privacy) — neither reveals whether the account
  // exists, only that this IP/address/challenge failed a neutral check.
  // Every other outcome, including an unknown email (which GoTrue does not
  // even report for this endpoint), takes the identical path below: set the
  // routing cookie and move to Screen 2. Existence can never be inferred
  // from which branch ran.
  if (error && isRateLimitError(error as GoTrueError)) {
    return { ok: false, code: "authPasswordPreview.error.rateLimited", email: email.data };
  }
  if (error && isCaptchaError(error as GoTrueError)) {
    return { ok: false, code: "authPasswordPreview.error.captchaRejected", email: email.data };
  }

  const store = await cookies();
  store.set(RECOVERY_EMAIL_COOKIE, email.data, {
    httpOnly: true,
    sameSite: "lax",
    path: RECOVERY_FLOW_PATH,
    maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
  });

  redirect(`${RECOVERY_FLOW_PATH}/verify`);
}

/** Screen 2 reads the destination email server-side only — never from a client-supplied field or the URL. */
export async function recoveryFlowEmail(): Promise<string | null> {
  const store = await cookies();
  return store.get(RECOVERY_EMAIL_COOKIE)?.value ?? null;
}

// ---------------------------------------------------------------------------
// Forgot password — Screen 2: verify the recovery code. Establishes a
// recovery session (Supabase does not scope what it can do — see
// `recovery-session.ts`) and moves to Screen 3.
// ---------------------------------------------------------------------------
export async function verifyRecoveryCode(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const store = await cookies();
  const email = store.get(RECOVERY_EMAIL_COOKIE)?.value;
  const token = formData.get("token");
  if (!email) return { ok: false, code: "authPasswordPreview.error.recoveryStateMissing" };
  if (typeof token !== "string" || !otpSchema.test(token)) {
    return { ok: false, code: "authPasswordPreview.error.invalidCode" };
  }

  // ISOLATED client — this session is NEVER persisted to the app's normal
  // cookies. See the module doc comment and `recovery-grant.ts`'s.
  const isolated = createIsolatedAuthClient();
  const { data, error } = await isolated.auth.verifyOtp({ email, token, type: "recovery" });
  if (error || !data.session) {
    return { ok: false, code: verifyFailureCode((error ?? {}) as GoTrueError) };
  }

  const grant = encryptRecoveryGrant({
    email,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    exp: Date.now() + RECOVERY_GRANT_TTL_SECONDS * 1000,
  });
  store.set(RECOVERY_GRANT_COOKIE, grant, {
    httpOnly: true,
    sameSite: "lax",
    path: RECOVERY_FLOW_PATH,
    maxAge: RECOVERY_GRANT_TTL_SECONDS,
  });

  // Deliberately NOT `redirect()` here — a Server-Action-triggered redirect
  // immediately following a fresh Set-Cookie can resolve the redirect
  // target's page before that response has round-tripped through the
  // browser (see the revision-2 postmortem preserved in git history).
  // Returning `ok: true` and letting the CLIENT navigate guarantees the
  // grant cookie is already committed first.
  return { ok: true };
}

/** Screen 2's resend — same cookie-sourced email, same isolated client, same neutral-safe rate-limit surfacing. */
export async function resendRecoveryCode(
  _prev: PasswordAuthState,
  // useActionState requires this shape; the resend has nothing to read from the form.
  _formData: FormData,
): Promise<PasswordAuthState> {
  void _prev;
  void _formData;
  const store = await cookies();
  const email = store.get(RECOVERY_EMAIL_COOKIE)?.value;
  if (!email) return { ok: false, code: "authPasswordPreview.error.recoveryStateMissing" };

  const isolated = createIsolatedAuthClient();
  const redirectTo = await absoluteUrl(`${RECOVERY_FLOW_PATH}/reset`);
  const { error } = await isolated.auth.resetPasswordForEmail(email, { redirectTo });
  if (error && isRateLimitError(error as GoTrueError)) {
    return { ok: false, code: "authPasswordPreview.error.rateLimited", email };
  }
  return { ok: true, code: "authPasswordPreview.info.resetSent", email };
}

/**
 * Screen 3's page guard. Deliberately NOT a session check — there is no
 * session to check; the isolated recovery flow never created one in the
 * app's normal cookies. Decrypting the grant IS the authorization check.
 */
export async function requireRecoverySession(): Promise<{ email: string } | null> {
  const store = await cookies();
  const grant = decryptRecoveryGrant(store.get(RECOVERY_GRANT_COOKIE)?.value);
  if (!grant) return null;
  return { email: grant.email };
}

// ---------------------------------------------------------------------------
// Forgot password — Screen 3: set the new password. Re-decrypts and
// re-validates the grant here (not just at the page level — defense in
// depth against a page-guard bypass). Authenticates the ONE `updateUser`
// call with the recovery grant's bearer token via the existing
// explicit-Bearer-token client — never the cookie-backed one, so this still
// never creates or touches a normal app session. On success: ends every
// session this user holds (the recovery grant's own included) and requires
// a fresh Email + Password sign-in rather than continuing into the app.
// ---------------------------------------------------------------------------
export async function resetPasswordAndSignOut(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const store = await cookies();
  const grant = decryptRecoveryGrant(store.get(RECOVERY_GRANT_COOKIE)?.value);
  if (!grant) {
    return { ok: false, code: "authPasswordPreview.error.recoveryStateMissing" };
  }

  const parsed = passwordWithContextSchema([grant.email]).safeParse(formData.get("password"));
  const confirm = formData.get("confirmPassword");
  if (!parsed.success) {
    return { ok: false, code: passwordIssueCode(parsed) };
  }
  if (parsed.data !== confirm) {
    return { ok: false, code: "authPasswordPreview.error.passwordMismatch" };
  }

  // A fresh, isolated, non-persisting client — NOT `createServerSupabaseClient`
  // (a bare `Authorization` header is not enough for GoTrue SDK auth methods;
  // they read the CLIENT's own in-memory session via `_useSession`, so the
  // session has to be explicitly hydrated with `setSession` first). This
  // client is thrown away at the end of this call — its in-memory session
  // never touches the app's normal cookies either way.
  const recoveryClient = createIsolatedAuthClient();
  const { error: sessionError } = await recoveryClient.auth.setSession({
    access_token: grant.accessToken,
    refresh_token: grant.refreshToken,
  });
  if (sessionError) {
    return { ok: false, code: "authPasswordPreview.error.recoveryStateMissing" };
  }

  const { data: updateData, error } = await recoveryClient.auth.updateUser({ password: parsed.data });
  if (error || !updateData.user) {
    return { ok: false, code: passwordSetFailureCode((error ?? {}) as GoTrueError) };
  }

  await markPasswordAttachedAuthoritatively(updateData.user.id);

  // Supabase's `password_changed` notification email fires on this update
  // when [auth.email.notification.password_changed] is enabled — see
  // docs/frontend/auth-password-preview.md §Password-change notification.

  // §5: end every session this user holds, via the SAME hydrated recovery
  // session (the recovery grant's own session included). `scope:"global"` is
  // named explicitly even though it is the default. Documented Supabase
  // limitation: this revokes refresh tokens, but an already-issued ACCESS
  // TOKEN (JWT) some other tab/device is holding stays valid until it
  // naturally expires (`jwt_expiry`, 3600s locally) — global sign-out is not
  // instant revocation of a live access token. See the same doc section.
  await recoveryClient.auth.signOut({ scope: "global" });

  store.delete({ name: RECOVERY_EMAIL_COOKIE, path: RECOVERY_FLOW_PATH });
  store.delete({ name: RECOVERY_GRANT_COOKIE, path: RECOVERY_FLOW_PATH });
  store.set(RECOVERY_SUCCESS_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: RECOVERY_FLOW_PATH, maxAge: 60 });

  redirect(`${RECOVERY_FLOW_PATH}/success`);
}

/**
 * Screen 4's gate: only reachable immediately after a real reset in THIS
 * browser. Called from the Screen 4 Server COMPONENT (not a Server Action),
 * which Next.js only allows to READ cookies — writing/deleting one there
 * throws ("Cookies can only be modified in a Server Action or Route
 * Handler"). So this does not delete the cookie; the 60s `maxAge` set in
 * `resetPasswordAndSignOut` is what keeps it one-time-in-practice — a
 * refresh within that short window still shows success, which is an
 * accepted, deliberately narrow tradeoff (not a security boundary: the
 * account's session was already ended by the time this cookie exists).
 */
export async function consumeRecoverySuccess(): Promise<boolean> {
  const store = await cookies();
  return store.get(RECOVERY_SUCCESS_COOKIE)?.value === "1";
}

// ---------------------------------------------------------------------------
// Existing-passwordless-user migration: an already-signed-in caller with no
// password sets one. Step-up verification via `reauthenticate()` (a fresh
// nonce emailed to the caller's own confirmed address) rather than trusting
// the existing session alone — this is a sensitive, credential-adding change.
// ---------------------------------------------------------------------------
export async function requestMigrationCode(_prev: PasswordAuthState, _formData: FormData): Promise<PasswordAuthState> {
  void _prev;
  void _formData;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "authPasswordPreview.error.sessionExpired" };

  const { error } = await supabase.auth.reauthenticate();
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited" };
    }
    return { ok: false, code: "authPasswordPreview.error.sendFailed" };
  }
  return { ok: true, code: "authPasswordPreview.info.codeSent", email: user.email ?? undefined };
}

export async function completeMigration(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "authPasswordPreview.error.sessionExpired" };

  const nonce = formData.get("token");
  if (typeof nonce !== "string" || !otpSchema.test(nonce)) {
    return { ok: false, code: "authPasswordPreview.error.invalidCode" };
  }
  const parsed = passwordWithContextSchema([user.email ?? ""]).safeParse(formData.get("password"));
  const confirm = formData.get("confirmPassword");
  if (!parsed.success) return { ok: false, code: passwordIssueCode(parsed) };
  if (parsed.data !== confirm) return { ok: false, code: "authPasswordPreview.error.passwordMismatch" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data, nonce });
  if (error) {
    return { ok: false, code: passwordSetFailureCode(error as GoTrueError) };
  }
  await markPasswordAttachedAuthoritatively(user.id);
  return { ok: true, code: "authPasswordPreview.migration.done" };
}

// ---------------------------------------------------------------------------
// Authenticated Change Password — distinct from Forgot Password. Requires the
// CURRENT password (re-verified via `signInWithPassword`, matching the
// supplied reference UI's "Current Password" field), not the existing
// session alone.
// ---------------------------------------------------------------------------
export async function changePassword(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, code: "authPasswordPreview.error.sessionExpired" };

  const currentPassword = formData.get("currentPassword");
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return { ok: false, code: "authPasswordPreview.error.currentPasswordRequired" };
  }
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (reauthError) {
    if (isRateLimitError(reauthError as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited" };
    }
    return { ok: false, code: "authPasswordPreview.error.currentPasswordWrong" };
  }

  const parsed = passwordWithContextSchema([user.email]).safeParse(formData.get("newPassword"));
  const confirm = formData.get("confirmNewPassword");
  if (!parsed.success) return { ok: false, code: passwordIssueCode(parsed) };
  if (parsed.data !== confirm) return { ok: false, code: "authPasswordPreview.error.passwordMismatch" };
  if (parsed.data === currentPassword) {
    return { ok: false, code: "authPasswordPreview.error.samePassword" };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ok: false, code: passwordSetFailureCode(error as GoTrueError) };

  // §5-equivalent for an authenticated change: keep this session, but end
  // every OTHER one, matching "changing your password should not leave a
  // stolen session valid elsewhere."
  await supabase.auth.signOut({ scope: "others" });

  return { ok: true, code: "authPasswordPreview.changePassword.done" };
}

/** Sign out and return to the preview's own sign-in screen. */
export async function previewSignOut(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/preview/auth-password/sign-in");
}
