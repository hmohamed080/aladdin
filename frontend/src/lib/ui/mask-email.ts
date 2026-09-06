/**
 * `name@example.com` → `n••••@example.com`.
 *
 * Shared by both settings pages (`/b2b/settings`, `/home/settings`) — the
 * caller knows their own address; masking keeps it off a screen that gets
 * shown to a client or screenshared.
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  return `${user.slice(0, 1)}${"•".repeat(Math.max(user.length - 1, 1))}@${domain}`;
}
