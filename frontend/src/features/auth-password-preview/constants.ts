/**
 * Shared client-facing constants for the password-auth preview. Kept out of
 * `server/actions/auth-password-preview.ts` because a `"use server"` file may
 * only export async functions (Next.js build-time restriction) — a plain
 * constant there fails the production build even though `tsc` accepts it.
 */

/** ~60s per docs/frontend/auth-password-preview.md §OTP security. A resend within this window still
 * hits Supabase's real server-side rate limit (`auth.rate_limit.email_sent`, `auth.email.max_frequency`)
 * regardless of this client-facing cooldown — this constant is UX pacing, never the security control. */
export const RESEND_COOLDOWN_SECONDS = 60;
