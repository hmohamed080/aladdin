/**
 * `test789f@test.com` → `t******f@test.com`.
 *
 * Shared by the settings pages (`/b2b/settings`, `/home/settings`, Showroom
 * settings) — the caller knows their own address; masking keeps it off a screen
 * that gets shown to a client or screenshared. The first and last character of
 * the local part stay so the person can recognize which address it is; a local
 * part of one or two characters shows only its first, never all of it.
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  if (user.length <= 2) return `${user.slice(0, 1)}*@${domain}`;
  return `${user.slice(0, 1)}${"*".repeat(user.length - 2)}${user.slice(-1)}@${domain}`;
}
