/**
 * Error classification and timing shared by EVERY e-mail registration entry point (marketplace sign-up in server/actions/auth-password-preview.ts
 * and the invited-staff sign-up in server/actions/staff-invitation.ts). One implementation, so the two flows cannot drift apart on rate-limit
 * handling, account-enumeration normalization or response timing. Pure functions only: this module is NOT a Server Actions file.
 */
export type GoTrueError = { code?: string; status?: number; message?: string };


export function isRateLimitError(error: GoTrueError): boolean {
  return (
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_sms_send_rate_limit" ||
    error.status === 429
  );
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
export function isAccountExistsError(error: GoTrueError): boolean {
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
export const REGISTRATION_RESPONSE_FLOOR_MS = 500;


/**
 * Pads the wall-clock time since `callStart` up to
 * `REGISTRATION_RESPONSE_FLOOR_MS` — never shortens a call that was already
 * slower than the floor (a real rate-limit/network-retry delay is left
 * alone; this only ever adds time, never removes it). Call ONLY for the
 * outcomes the floor is meant to normalize — see each call site's comment
 * for why rate-limit/captcha-rejected/generic-failure responses are
 * deliberately excluded.
 */
export async function padToRegistrationFloor(callStart: number): Promise<void> {
  const remaining = REGISTRATION_RESPONSE_FLOOR_MS - (Date.now() - callStart);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
