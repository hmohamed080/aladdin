/**
 * The WORK CONTEXT model — "where am I working", never "who am I".
 *
 * A workspace is DERIVED, not stored (there is deliberately no `workspaces`
 * table): Personal = User + Profile, Business = Organization + active Membership.
 * Switching context changes the data scope of the surfaces you see; it never
 * touches `users.primary_account_type`, never adds or removes a membership, and
 * never grants authority — every request still re-checks authentication, active
 * membership, capability, branch scope and RLS.
 *
 * Pure module: no server imports, so the resolution rules are unit-testable.
 */

/** Cookie sentinel for the Personal context (org ids are uuids, so no collision). */
export const PERSONAL_CONTEXT = "personal";

/**
 * The context cookies. They record a PREFERENCE and confer no authority, which is
 * why they can live in a pure module: a forged or stale value can only ever
 * resolve to something the caller already has.
 */
export const ORG_COOKIE = "aladdin-org";
export const BRANCH_COOKIE = "aladdin-branch";

export type Relationship = "owner" | "manager" | "member";

export type WorkspaceEntry =
  | { kind: "personal"; name: string; persona: string | null }
  | {
      kind: "business";
      organizationId: string;
      name: string;
      orgType: string | null;
      relationship: Relationship;
    };

export type WorkContext = { kind: "personal" } | { kind: "business"; organizationId: string };

export function personalEntry(entries: WorkspaceEntry[]) {
  return entries.find((e): e is Extract<WorkspaceEntry, { kind: "personal" }> => e.kind === "personal");
}

export function businessEntries(entries: WorkspaceEntry[]) {
  return entries.filter(
    (e): e is Extract<WorkspaceEntry, { kind: "business" }> => e.kind === "business",
  );
}

/**
 * The caller's SELECTED work context, honoring the cookie only when it names a
 * context they genuinely have. A stale cookie (membership since suspended or
 * revoked, or a Personal context that no longer exists) resolves safely rather
 * than failing: Personal when usable, otherwise a valid active organization,
 * otherwise null (the caller has no usable workspace at all).
 */
export function resolveWorkContext(
  entries: WorkspaceEntry[],
  cookieValue: string | undefined,
): WorkContext | null {
  const personal = personalEntry(entries);
  const businesses = businessEntries(entries);

  if (cookieValue === PERSONAL_CONTEXT && personal) return { kind: "personal" };
  const named = cookieValue ? businesses.find((b) => b.organizationId === cookieValue) : undefined;
  if (named) return { kind: "business", organizationId: named.organizationId };

  if (personal) return { kind: "personal" };
  if (businesses[0]) return { kind: "business", organizationId: businesses[0].organizationId };
  return null;
}

/**
 * Deterministic landing. Platform authority wins outright (it is granted by
 * `platform_role_grants`, never by an account type). Otherwise the caller lands in
 * the work context they selected; a business-only identity therefore reaches /b2b
 * and never a fake, empty Personal home, and a personal identity never lands in
 * the Sales cockpit.
 *
 * `/home` is also the account-safe fallback for a caller with no usable workspace
 * (for example after their only membership was revoked) — that page renders a
 * clear state rather than bouncing, so there is no redirect loop.
 */
export function landingFor(
  context: WorkContext | null,
  isPlatformStaff: boolean,
): "/admin" | "/b2b" | "/home" {
  if (isPlatformStaff) return "/admin";
  return context?.kind === "business" ? "/b2b" : "/home";
}

/**
 * The organization a B2B route should render for. B2B surfaces are business by
 * definition, so a Personal selection does not bounce the caller out of a link
 * they followed — it simply falls through to a valid organization. Returns null
 * when the caller has no active membership at all.
 */
export function resolveActiveBusinessId(
  entries: WorkspaceEntry[],
  cookieValue: string | undefined,
): string | null {
  const businesses = businessEntries(entries);
  const named = cookieValue ? businesses.find((b) => b.organizationId === cookieValue) : undefined;
  return named?.organizationId ?? businesses[0]?.organizationId ?? null;
}
