/**
 * Allowlist for post-auth redirect targets. Only internal app paths under a known
 * prefix are honored — never an absolute URL or a protocol-relative `//host` (open
 * redirect). Anything else falls back to the workspace; the post-auth action
 * then replaces that fallback with the caller's canonical derived surface.
 */
const ALLOWED_PREFIXES = ["/admin", "/b2b", "/home", "/onboarding", "/auth/invite/", "/auth/staff-invitation", "/settings/contact-email/"] as const;

/**
 * Marketplace buyer pages a visitor is sent to sign in from (checkout, their orders). They belong to
 * no workspace surface, so they are kept whatever the caller's landing surface is. Exact shapes only.
 */
const MARKETPLACE_RETURN = /^\/marketplace\/(checkout(\?[A-Za-z0-9=&%._-]{0,200})?|orders(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$/;

export function isMarketplaceReturn(value: string): boolean {
  return MARKETPLACE_RETURN.test(value);
}

export function sanitizeNext(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    if (ALLOWED_PREFIXES.some((p) => value === p || value.startsWith(p))) return value;
    if (isMarketplaceReturn(value)) return value;
  }
  return "/b2b";
}

/**
 * Where a signed-in caller goes after the registration gate: a sanitized deep link survives when it
 * belongs to the caller's own landing surface, or is a Marketplace buyer page; otherwise the landing.
 */
export function postAuthDestination(next: string, landing: string): string {
  return next === landing || next.startsWith(`${landing}/`) || isMarketplaceReturn(next) ? next : landing;
}
