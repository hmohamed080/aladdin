"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { markPasswordAttachedAuthoritatively, savePendingRegistration, PASSWORD_SET_FLAG } from "@/lib/supabase/admin-server";
import { CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import {
  createIsolatedAuthClient,
  encryptRecoveryGrant,
  decryptRecoveryGrant,
  RECOVERY_GRANT_TTL_SECONDS,
} from "@/lib/supabase/recovery-grant";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { sanitizeNext } from "@/server/auth/next";
import { clientIpFrom, verifyTurnstileToken } from "@/server/auth/turnstile";
import { resolveActiveLanding } from "@/server/queries/landing";
import { hasAppAccess, type RegistrationState } from "@/server/queries/registration";
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
 * REGISTRATION ARCHITECTURE (revision 4 — promoted to Architecture B,
 * replacing revision 1-3's OTP-first Architecture A): `signUp({email,
 * password})` (`requestPasswordSignUp`) sets the password ATOMICALLY as part
 * of that one call, before any confirmation email is sent and before any
 * session exists (`enable_confirmations=true`, LOCAL ONLY — see
 * `supabase/config.toml`). The confirmation email carries a 6-digit
 * `{{.Token}}` (`[auth.email.template.confirmation]`, same code-based UX as
 * every other OTP in this app); `verifyPasswordSignUp` verifies it with
 * `verifyOtp({type:"signup"})` — the EmailOtpType the installed
 * `@supabase/auth-js` actually defines for this exact case, confirmed by
 * reading its shipped `.d.ts`, not assumed — and that call alone produces a
 * fully authenticated, fully password-usable session. The password is
 * therefore submitted exactly ONCE, to `signUp()`; the OTP step that follows
 * only ever handles the 6-digit code and NEVER re-collects, re-holds, or
 * re-submits the password (no hidden password field, no query/cookie/storage
 * persistence) — see `sign-up-form.tsx`. This has no equivalent of
 * Architecture A's interrupted "confirmed but no password" window, so the
 * `resumePasswordSignUpEmail`/`finishPasswordSignUp` resume machinery
 * revisions 1-3 needed for that gap is gone; `markPasswordAttachedAuthoritatively`
 * is still stamped after a successful verify, but now purely so
 * `migrationEligibility()` (the SEPARATE, unrelated existing-passwordless-user
 * migration flow below) correctly reports "already has a password" for an
 * account that registered through this path — see that function's doc
 * comment. Full investigation, the enumeration-normalization design
 * (`isAccountExistsError` below), and the `enable_confirmations` impact map
 * across every canonical call site: docs/frontend/auth-password-preview.md
 * §Registration architecture.
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
 * APPLICATION-SCOPED CAPTCHA gate (server/auth/turnstile.ts): the token is
 * verified with Cloudflare Siteverify HERE, before Supabase Auth is called —
 * Supabase's global `[auth.captcha]` stays OFF, so nothing downstream would
 * ever judge it. Fails closed. Returns the neutral error code to show, or
 * null when the token verified. Never exposes Cloudflare's own error codes.
 */
async function captchaFailure(formData: FormData): Promise<string | null> {
  const h = await headers();
  const verdict = await verifyTurnstileToken(formData.get("captchaToken"), {
    remoteIp: clientIpFrom((name) => h.get(name)),
  });
  if (verdict.ok) return null;
  return verdict.reason === "missing"
    ? "authPasswordPreview.error.captchaRequired"
    : "authPasswordPreview.error.captchaRejected";
}

/**
 * `signUp()`/`resend({type:"signup"})` on an email with an existing,
 * CONFIRMED account — the one case GoTrue does NOT obfuscate on its own
 * (verified directly against local GoTrue): a still-UNCONFIRMED re-signup
 * IS already obfuscated by GoTrue itself (returns success, the same user id,
 * re-sends the same confirmation email — indistinguishable from a fresh
 * signup with no application code needed). This distinguishing error is the
 * ONE thing application code must catch and collapse into the same generic
 * response a genuine new registration gets — see `requestPasswordSignUp`'s
 * and `resendPasswordSignUpCode`'s doc comments and
 * docs/frontend/auth-password-preview.md §Account enumeration.
 */
function isAccountExistsError(error: GoTrueError): boolean {
  return error.code === "user_already_exists" || error.code === "email_exists";
}

/**
 * Minimum wall-clock duration `requestPasswordSignUp`/`resendPasswordSignUpCode`
 * enforce for their enumeration-relevant outcomes — closes the timing
 * side-channel the enumeration normalization above does not, on its own,
 * close (docs/frontend/auth-password-preview.md §Account enumeration has the
 * full before/after measurement). Measured directly against the REAL public
 * Server Action (click-to-UI-settled, not raw GoTrue — 4 samples per state,
 * local dev machine under normal load), unpadded: genuine-success (fresh OR
 * GoTrue-obfuscated-unconfirmed-resignup) topped out at 371ms; the
 * `isAccountExistsError`-normalized confirmed-existing path topped out at
 * 277ms. 500ms is comfortably above every observed sample in every state —
 * once every relevant outcome is padded up to this same floor, the
 * previously observed gap collapses into scheduler jitter (single-digit to
 * low-double-digit ms) rather than a deterministic tens-of-ms signal an
 * attacker could statistically distinguish. Deliberately NOT larger: 500ms
 * is still within the range that reads as "the app is doing something," not
 * "the app is slow," for a registration submit (a once-per-account action,
 * not a hot path) — this is a floor for THIS specific pair of outcomes, not
 * a general rate limit or a substitute for one.
 */
const REGISTRATION_RESPONSE_FLOOR_MS = 500;

/**
 * Pads the wall-clock time since `callStart` up to
 * `REGISTRATION_RESPONSE_FLOOR_MS` — never shortens a call that was already
 * slower than the floor (a real rate-limit/network-retry delay is left
 * alone; this only ever adds time, never removes it). Call ONLY for the
 * outcomes the floor is meant to normalize — see each call site's comment
 * for why rate-limit/captcha-rejected/generic-failure responses are
 * deliberately excluded.
 */
async function padToRegistrationFloor(callStart: number): Promise<void> {
  const remaining = REGISTRATION_RESPONSE_FLOOR_MS - (Date.now() - callStart);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
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

const FINISH_REGISTRATION_PATH = "/preview/auth-password/finish-registration";

/**
 * Safe diagnostics for a post-OTP registration step that failed: the step and
 * the Postgres error code only — never the username, email, password, OTP,
 * session or CAPTCHA token.
 */
function logRegistrationStepFailure(step: "account_type" | "username", error: { code?: string }): void {
  console.error(`password registration: post-OTP ${step} step failed (code ${error.code ?? "unknown"})`);
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
  if (next.startsWith("/onboarding") || next.startsWith("/preview/auth-password/finish-registration") || next.startsWith("/auth/invite/")) {
    redirect(next);
  }
  const { data: state } = await supabase.rpc("my_registration_state");
  const registrationState = state as RegistrationState;
  // A verified-but-not-yet-access_ready caller (missing account type or
  // username) is sent to THIS preview's own minimal recovery screen, not the
  // legacy six-step /onboarding wizard — see finish-registration/page.tsx.
  if (registrationState === "account_type_pending" || registrationState === "username_pending") {
    redirect("/preview/auth-password/finish-registration");
  }
  if (!hasAppAccess(registrationState)) redirect("/onboarding");

  const landing = await resolveActiveLanding(supabase);
  const destination = next === landing || next.startsWith(`${landing}/`) ? next : landing;
  redirect(destination);
}

// ---------------------------------------------------------------------------
// Registration — step 1: collect email + password + confirm, submit BOTH to
// `signUp()` in one call (Architecture B). No session is created yet
// (`enable_confirmations=true`); GoTrue emails the 6-digit confirmation code.
// ---------------------------------------------------------------------------
export async function requestPasswordSignUp(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const parsed = registrationSchema.safeParse({
    email: formData.get("email"),
    username: formData.get("username"),
    accountType: formData.get("accountType"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: (first?.message as string) ?? "authPasswordPreview.error.invalidEmail" };
  }

  // Server-side authority for the account-type choice — the client-supplied
  // key is never trusted beyond looking it up here. A comingSoon/transitional
  // key (a forged form submission) is rejected exactly like an unknown one.
  const choice = CHOICES_BY_KEY[parsed.data.accountType];
  if (!choice || choice.comingSoon || choice.transitional) {
    return { ok: false, code: "authPasswordPreview.error.accountTypeRequired", email: parsed.data.email };
  }

  const consented = CONSENT_TYPES.every((type) => formData.get(`consent_${type}`) === "on");
  if (!consented) {
    return { ok: false, code: "authPasswordPreview.error.consentRequired", email: parsed.data.email };
  }

  // Only a Cloudflare-verified token lets signUp() run at all.
  const captchaCode = await captchaFailure(formData);
  if (captchaCode) return { ok: false, code: captchaCode, email: parsed.data.email };

  const supabase = await getServerSupabase();

  // USERNAME PRE-FLIGHT — before any Auth user or confirmation email exists.
  // `username_available` is the authoritative, anon-callable boolean check; it
  // answers false for reserved AND taken names alike, so this reveals nothing
  // beyond the intended "unavailable" contract (and nothing about the EMAIL).
  // It is NOT a reservation: the post-OTP `profile_set_username` claim in
  // verifyPasswordSignUp stays the final authority for the OTP-window race.
  // An RPC failure is never reported as "unavailable" — it is a neutral retry.
  const { data: usernameAvailable, error: availabilityError } = await supabase.rpc("username_available", {
    p_username: parsed.data.username,
  });
  if (availabilityError || typeof usernameAvailable !== "boolean") {
    return { ok: false, code: "authPasswordPreview.error.sendFailed", email: parsed.data.email };
  }
  if (!usernameAvailable) {
    return { ok: false, code: "registration.error.usernameUnavailable", email: parsed.data.email };
  }

  const callStart = Date.now();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited", email: parsed.data.email };
    }
    // ENUMERATION NORMALIZATION (§Account enumeration) — see
    // `isAccountExistsError`'s doc comment. Collapse into the exact same
    // success response a genuine new registration gets; never a different
    // code path, never GoTrue's own wording. Response-time normalized too
    // (`padToRegistrationFloor`) — the enumeration-safe response SHAPE alone
    // is not enough if the two paths remain distinguishable by how fast they
    // arrive. Deliberately NO pending-registration write on this branch —
    // there is no new user id to key it by, and staging state for an
    // existing account's id would be a foothold for exactly the enumeration
    // this branch exists to close.
    if (isAccountExistsError(error as GoTrueError)) {
      await padToRegistrationFloor(callStart);
      return { ok: true, code: "authPasswordPreview.info.codeSent", email: parsed.data.email };
    }
    return { ok: false, code: "authPasswordPreview.error.sendFailed", email: parsed.data.email };
  }

  // Stage username + account-type NOW, keyed by the user id signUp() just
  // returned — before any confirmation, so a refresh/restart on the OTP step
  // does not lose the choice (see Increment 6,
  // supabase/migrations/20260924090006_pending_registrations.sql). Never the
  // password. Best-effort: verifyPasswordSignUp falls back to the
  // finish-registration recovery screen if this is ever lost.
  if (data?.user) {
    await savePendingRegistration({
      userId: data.user.id,
      username: parsed.data.username,
      audienceKind: choice.track === "business" ? "organization_type" : "persona_type",
      audienceValue: choice.accountType ?? "",
    });
  }

  await padToRegistrationFloor(callStart);
  return { ok: true, code: "authPasswordPreview.info.codeSent", email: parsed.data.email };
}

// ---------------------------------------------------------------------------
// Registration — resend the signup confirmation code. Calls GoTrue's own
// `resend()` endpoint — NEVER a second `signUp()` call, which would
// needlessly resubmit (and require re-collecting) the password; `resend()`
// only re-sends the pending confirmation email for an identity that already
// exists from step 1. Takes just the email — the password is never
// resubmitted after its one `signUp()` call above.
//
// Enumeration-normalized the same way as `requestPasswordSignUp`, though
// verified directly against local GoTrue that `resend({type:"signup"})` on
// an ALREADY-CONFIRMED account is already safe on its own: it returns an
// empty `{}` success body with no error and sends no new mail (confirmed via
// Mailpit) — GoTrue itself never surfaces a distinguishing error here. The
// `isAccountExistsError` branch below is defense-in-depth for a future
// GoTrue version that might start erroring on this case, not a currently
// exercised path.
// ---------------------------------------------------------------------------
export async function resendPasswordSignUpCode(
  _prev: PasswordAuthState,
  formData: FormData,
): Promise<PasswordAuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, code: "authPasswordPreview.error.invalidEmail" };

  const captchaCode = await captchaFailure(formData);
  if (captchaCode) return { ok: false, code: captchaCode, email: email.data };

  const supabase = await getServerSupabase();
  const callStart = Date.now();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.data,
  });
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited", email: email.data };
    }
    if (isAccountExistsError(error as GoTrueError)) {
      await padToRegistrationFloor(callStart);
      return { ok: true, code: "authPasswordPreview.info.codeSent", email: email.data };
    }
    return { ok: false, code: "authPasswordPreview.error.sendFailed", email: email.data };
  }
  await padToRegistrationFloor(callStart);
  return { ok: true, code: "authPasswordPreview.info.codeSent", email: email.data };
}

// ---------------------------------------------------------------------------
// Registration — step 2: verify the confirmation code. The password was
// already set atomically by `signUp()` in step 1 — this call ONLY confirms
// the email and exchanges the code for a session; the password is NEVER
// re-collected, re-held, or re-submitted here (no password form field exists
// on this step at all — see `sign-up-form.tsx`).
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

  const supabase = await getServerSupabase();
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    email: email.data,
    token,
    type: "signup",
  });
  if (verifyError || !verifyData.user) {
    return { ok: false, code: verifyFailureCode((verifyError ?? {}) as GoTrueError), email: email.data };
  }

  // Authoritative, server-controlled stamp (see `lib/supabase/admin-server.ts`
  // and the module doc comment) — under Architecture B this is no longer
  // covering an interrupted-signup window (signUp() sets the password
  // atomically; there is nothing to resume here). It is stamped purely so
  // `migrationEligibility()` below — a SEPARATE, unrelated flow — correctly
  // reports "already has a password" if this account later reaches the
  // existing-passwordless-user migration page.
  await markPasswordAttachedAuthoritatively(verifyData.user.id);

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // Best-effort, matches production sign-up: never block a verified+credentialed
  // session on a consent-write hiccup.
  await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });

  // Consume the pending registration staged at signUp() time (Increment 6).
  // A session now exists (verifyOtp succeeded above), so this reads
  // auth.uid() itself — no user-id parameter, standard pattern. Everything
  // returned is REVALIDATED by the RPCs it is applied through
  // (onboarding_select_account_type, profile_set_username) — the pending row
  // is a convenience cache, never an authority. If nothing is returned (the
  // row expired, or the earlier best-effort write never landed), or the
  // username claim loses a race to someone else, postSessionRedirect below
  // routes to the finish-registration recovery screen based on the
  // resulting registration state — never the legacy wizard.
  const { data: pending } = await supabase.rpc("pending_registration_consume");
  const pendingRow = Array.isArray(pending) ? pending[0] : pending;
  if (pendingRow) {
    const track = pendingRow.audience_kind === "organization_type" ? "business" : "professional";
    const { error: accountTypeError } = await supabase.rpc("onboarding_select_account_type", {
      p_track: track,
      p_account_type: pendingRow.audience_value,
    });
    if (accountTypeError) logRegistrationStepFailure("account_type", accountTypeError);

    // The AUTHORITATIVE username claim. The Step-1 pre-flight made a collision
    // rare, but another registrant can still claim the same normalized name
    // during this one's OTP window. Never ignored:
    //   * 23505 (unavailable — reserved or taken, deliberately not told
    //     apart) → the narrow recovery screen, which explains that the chosen
    //     name is no longer available. The session and the account type
    //     recorded above are kept; nothing else is asked again.
    //   * anything else → safe diagnostics, then the same recovery screen
    //     (state-derived, so it asks only for what is actually missing).
    const { error: usernameError } = await supabase.rpc("profile_set_username", { p_username: pendingRow.username });
    if (usernameError) {
      if (usernameError.code === "23505") redirect(`${FINISH_REGISTRATION_PATH}?reason=username_unavailable`);
      logRegistrationStepFailure("username", usernameError);
      redirect(FINISH_REGISTRATION_PATH);
    }
    if (accountTypeError) redirect(FINISH_REGISTRATION_PATH);
  }

  return postSessionRedirect(supabase, "/onboarding");
}

/**
 * Migration-page guard: is the current caller signed in, and does their
 * account already have a password attached (via any path — Architecture-B
 * sign-up, migration, or a past reset all stamp the same flag)? Unlike
 * revisions 1-3, there is no "interrupted sign-up" state left to distinguish
 * this from — Architecture B's `signUp()` sets the password atomically, so
 * this is simply the general "does this account have a password" question,
 * asked for an ordinary already-signed-in passwordless user reaching the
 * migration page.
 */
export async function migrationEligibility(): Promise<{ email: string; hasPassword: boolean } | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { email: user.email, hasPassword: user.app_metadata?.[PASSWORD_SET_FLAG] === true };
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

  // No CAPTCHA on Sign In, by design: CAPTCHA is application-scoped to
  // Create Account and Forgot Password (server/auth/turnstile.ts), and
  // Supabase's global [auth.captcha] stays OFF, so password sign-in carries
  // no token and no added friction. Brute force is bounded by GoTrue's own
  // rate limits.
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password,
  });
  if (error) {
    if (isRateLimitError(error as GoTrueError)) {
      return { ok: false, code: "authPasswordPreview.error.rateLimited", email: email.data };
    }
    // Deliberately identical for "no such account", "wrong password", "email
    // not confirmed" and "user_banned" — see the module doc comment.
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

  // Same application-scoped gate as Create Account: no recovery email is ever
  // requested for an unverified token.
  const captchaCode = await captchaFailure(formData);
  if (captchaCode) return { ok: false, code: captchaCode, email: email.data };

  const isolated = createIsolatedAuthClient();
  const redirectTo = await absoluteUrl(`${RECOVERY_FLOW_PATH}/reset`);
  const { error } = await isolated.auth.resetPasswordForEmail(email.data, { redirectTo });

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
