/**
 * Helpers for the "known devices" list (Settings → Privacy & security). Each
 * browser carries a random, httpOnly device id cookie; the middleware records it
 * against the signed-in account once per session per day. The id identifies a
 * browser, never a person, and grants nothing: it is not an authentication
 * factor and is only ever sent back to the caller's own account.
 */

export const DEVICE_COOKIE = "aladdin_device";
export const DEVICE_SEEN_COOKIE = "aladdin_device_seen";
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The `session_id` claim of a Supabase access token (already validated by `getUser()` upstream). */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return isUuid(json?.session_id) ? json.session_id : null;
  } catch {
    return null;
  }
}

/** One marker per session per UTC day: the device is recorded again only when it changes. */
export function deviceSeenMarker(sessionId: string, now = new Date()): string {
  return `${sessionId}:${now.toISOString().slice(0, 10)}`;
}
