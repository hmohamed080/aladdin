import "server-only";

import { cookies } from "next/headers";

/**
 * Token-to-session handoff for Admin Staff invitations.
 *
 * The one-time link carries the token in its PATH only once: `GET /auth/staff-invitation/<token>` validates the shape, stores the token in
 * an httpOnly, SameSite=Lax, path-scoped cookie and redirects to the tokenless `/auth/staff-invitation`. From then on every step (sign-up,
 * e-mail verification, sign-in, acceptance) reads the token from this cookie on the server. The token therefore never appears in a `next`
 * parameter, a redirect target, a Referer header, a browser-history entry after the first hop, or any client-side state.
 *
 * The cookie confers nothing by itself: acceptance still needs a session whose CONFIRMED Auth e-mail equals the invited address.
 */
export const STAFF_INVITATION_COOKIE = "staff_inv";
export const STAFF_INVITATION_COOKIE_PATH = "/auth/staff-invitation";
export const STAFF_INVITATION_COOKIE_MAX_AGE_SECONDS = 30 * 60;
export const STAFF_TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: STAFF_INVITATION_COOKIE_PATH,
    maxAge: STAFF_INVITATION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** The pending token, or null when absent or malformed (a malformed value is never forwarded to the database). */
export async function readStaffInvitationToken(): Promise<string | null> {
  const value = (await cookies()).get(STAFF_INVITATION_COOKIE)?.value;
  return typeof value === "string" && STAFF_TOKEN_SHAPE.test(value) ? value : null;
}

export async function clearStaffInvitationToken(): Promise<void> {
  (await cookies()).delete({ name: STAFF_INVITATION_COOKIE, path: STAFF_INVITATION_COOKIE_PATH });
}
