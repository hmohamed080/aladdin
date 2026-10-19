/**
 * Pure decisions shared by the middleware and the per-request session helpers.
 * No I/O and no `server-only` import, so the middleware (and unit tests) can use
 * it directly. See `server/auth/session.ts` for why identity is read the way it is.
 */

/** The caller as a locally verified access token describes them. */
export type SessionIdentity = {
  /** `auth.users.id` — the same value RLS reads as `auth.uid()`. */
  id: string;
  /** Contact claims as of the token's issue (refreshed at most `jwt_expiry` later). */
  email: string | null;
  phone: string | null;
  /** `auth.sessions.id` the token belongs to, when present. */
  sessionId: string | null;
  /** Token expiry, seconds since the epoch. */
  expiresAt: number;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

/**
 * Claims from `auth.getClaims()` (signature and `exp` already verified) to an
 * identity. Anything that is not a signed-in user's token — no subject, a non-
 * `authenticated` role such as `anon` or `service_role`, no expiry — is no identity.
 */
export function identityFromClaims(claims: unknown): SessionIdentity | null {
  if (!claims || typeof claims !== "object") return null;
  const c = claims as Record<string, unknown>;
  const id = text(c.sub);
  if (!id || c.role !== "authenticated" || typeof c.exp !== "number") return null;
  return {
    id,
    email: text(c.email),
    phone: text(c.phone),
    sessionId: text(c.session_id),
    expiresAt: c.exp,
  };
}

/**
 * A router prefetch (Next.js `next-router-prefetch`) or a browser speculative
 * load (`Sec-Purpose` / `Purpose: prefetch`). Always a GET, never a mutation.
 */
export function isPrefetchRequest(method: string, headers: Headers): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (headers.has("next-router-prefetch")) return true;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch");
}

/** Surfaces that require a session (others render signed-out). */
export function isAuthRequiredPath(path: string): boolean {
  return (
    path.startsWith("/b2b") ||
    path.startsWith("/admin") ||
    path.startsWith("/home") ||
    path.startsWith("/onboarding")
  );
}

/** Surfaces a suspended account (PD-010) is routed away from. */
export function isProductSurfacePath(path: string): boolean {
  return isAuthRequiredPath(path) || path.startsWith("/settings") || path.startsWith("/business");
}

/**
 * Surfaces where a revoked session must be refused at once, not at token expiry:
 * the middleware asks the Auth server (`getUser()`) here instead of verifying the
 * token locally. Admin traffic is small, so this costs little.
 */
export function needsNetworkValidatedSession(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

/** Sign-in / sign-up entry pages a signed-in caller is sent away from. */
export function isSignedOutEntryPath(path: string): boolean {
  return (
    path === "/auth/sign-in" ||
    path === "/auth/sign-up" ||
    path === "/installer/sign-in" ||
    path === "/installer/sign-up" ||
    path === "/showroom/sign-in" ||
    path === "/showroom/sign-up"
  );
}
