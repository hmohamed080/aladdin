/**
 * Allowlist for post-auth redirect targets. Only internal app paths under a known
 * prefix are honored — never an absolute URL or a protocol-relative `//host` (open
 * redirect). Anything else falls back to the workspace; the post-auth action
 * then replaces that fallback with the caller's canonical derived surface.
 */
const ALLOWED_PREFIXES = ["/admin", "/b2b", "/home", "/onboarding", "/auth/invite/"] as const;

export function sanitizeNext(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    if (ALLOWED_PREFIXES.some((p) => value === p || value.startsWith(p))) return value;
  }
  return "/b2b";
}
