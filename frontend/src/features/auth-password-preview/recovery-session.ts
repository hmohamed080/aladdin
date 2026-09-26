import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Decodes the CURRENT session's access-token `amr` (Authentication Methods
 * Reference) claim — a standard Supabase/GoTrue JWT claim recording how the
 * session was established (docs.supabase.com/docs/reference/javascript/auth-verifyotp,
 * `jwtPayload.amr`). We do not re-verify the token's signature here: it only
 * reaches this helper after `getServerSupabase()`'s cookie-backed client has
 * already round-tripped through Supabase's own `auth.getUser()` elsewhere in
 * the same request path, so its authenticity is already established — this
 * only reads a claim off it.
 */
async function currentSessionAmrMethods(supabase: SupabaseClient<Database>): Promise<string[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return [];
  const segment = session.access_token.split(".")[1];
  if (!segment) return [];
  try {
    const payload = JSON.parse(Buffer.from(segment, "base64").toString("utf8")) as {
      amr?: Array<{ method?: string }>;
    };
    return (payload.amr ?? [])
      .map((entry) => entry.method)
      .filter((m): m is string => typeof m === "string");
  } catch {
    return [];
  }
}

/**
 * NOT CURRENTLY USED AS THE SECURITY GATE — kept as a verified, tested
 * `amr`-decoding utility and as a documented negative result.
 *
 * The original design gated Screen 3 ("create new password") on this
 * function returning true for the most recent `amr` entry being
 * `"recovery"`. That assumption was EMPIRICALLY WRONG: decoding a real
 * access token from local Supabase after `verifyOtp({type:"recovery"})`
 * shows `amr: [{method:"otp", ...}]` — the identical generic value a normal
 * email-OTP sign-in produces. GoTrue does not expose the OTP sub-type
 * (`email` vs `recovery` vs `signup`) via `amr`, so it cannot distinguish a
 * recovery session from an ordinary one. The actual gate is now
 * `RECOVERY_VERIFIED_COOKIE`, an httpOnly cookie `verifyRecoveryCode` sets
 * only after a successful recovery OTP verification (see
 * `server/actions/auth-password-preview.ts`).
 *
 * This function is left in place — correct as an `amr` decoder, useful if a
 * future Supabase/GoTrue version starts distinguishing OTP sub-types, and as
 * a recorded lesson: verify a third-party auth provider's exact claim
 * contents empirically before designing a security gate around them, rather
 * than trusting general documentation/blog-post phrasing.
 *
 * The still-real, still-documented gap this file's earlier version flagged
 * remains true regardless of which mechanism gates Screen 3: production
 * `middleware.ts` has no concept of a "recovery-restricted" session at all,
 * so if a recovery session reaches a normal protected route directly (e.g.
 * the user navigates to `/b2b` instead of continuing to Screen 3), today's
 * middleware lets it through like any other valid session. See
 * docs/frontend/auth-password-preview.md §Recovery-session security.
 */
export async function isRecoverySession(supabase: SupabaseClient<Database>): Promise<boolean> {
  const methods = await currentSessionAmrMethods(supabase);
  return methods[methods.length - 1] === "recovery";
}
