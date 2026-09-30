/**
 * Admin RBAC — the frontend's ONE view of platform authority (Admin Core 1A).
 *
 * The database is the source of truth: `admin_role_assignments` resolved by
 * `app.has_admin_permission()`, and — for the caller — `admin_my_access()`,
 * which the server loads into an `AdminAccess` (server/authorization/admin.ts).
 * This module is pure and client-safe: it only interprets that snapshot, so the
 * navigation, the page guards and the tests all read the SAME route table.
 *
 * Hiding a link or a button here is presentation only. Every read is RLS-scoped
 * and every mutation is an RPC that re-checks the permission itself.
 */

/** The permission catalog keys (mirror of `public.admin_permissions`, for type safety only). */
export const ADMIN_PERMISSIONS = [
  "users.read",
  "users.verify",
  "users.suspend",
  "organizations.read",
  "organizations.verify",
  "organizations.suspend",
  "referrals.read",
  "referrals.approve",
  "job_reviews.moderate",
  "points.read",
  "points.adjust",
  "points.reverse",
  "audit.read",
  "analytics.read",
  "admin_staff.read",
  "admin_staff.manage",
  "roles.read",
  "roles.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type AdminRoleSummary = { key: string; name: string; isSystem: boolean; rank: number };

/** The caller's effective Admin authority (platform scope). */
export type AdminAccess = {
  isStaff: boolean;
  rank: number;
  permissions: readonly AdminPermission[];
  /** Active platform roles, highest rank first. */
  roles: readonly AdminRoleSummary[];
};

export const NO_ADMIN_ACCESS: AdminAccess = { isStaff: false, rank: 0, permissions: [], roles: [] };

/** `"staff"` = any active Admin Staff member; an array = any ONE of those permissions. */
export type AdminRequirement = "staff" | AdminPermission | readonly AdminPermission[];

const KNOWN = new Set<string>(ADMIN_PERMISSIONS);

/** Parses the `admin_my_access()` JSON defensively: unknown keys are dropped, never trusted. */
export function parseAdminAccess(raw: unknown): AdminAccess {
  if (!raw || typeof raw !== "object") return NO_ADMIN_ACCESS;
  const r = raw as Record<string, unknown>;
  const rank = typeof r.rank === "number" && Number.isFinite(r.rank) ? r.rank : 0;
  const permissions = Array.isArray(r.permissions)
    ? (r.permissions.filter((p): p is AdminPermission => typeof p === "string" && KNOWN.has(p)))
    : [];
  const roles = Array.isArray(r.roles)
    ? r.roles.flatMap((x): AdminRoleSummary[] => {
        if (!x || typeof x !== "object") return [];
        const o = x as Record<string, unknown>;
        if (typeof o.key !== "string" || typeof o.name !== "string") return [];
        return [{ key: o.key, name: o.name, isSystem: o.is_system === true, rank: typeof o.rank === "number" ? o.rank : 0 }];
      })
    : [];
  const isStaff = r.is_staff === true && rank > 0;
  return isStaff ? { isStaff, rank, permissions, roles } : NO_ADMIN_ACCESS;
}

export function can(access: AdminAccess, permission: AdminPermission): boolean {
  return access.isStaff && access.permissions.includes(permission);
}

export function meets(access: AdminAccess, requirement: AdminRequirement): boolean {
  if (!access.isStaff) return false;
  if (requirement === "staff") return true;
  if (typeof requirement === "string") return can(access, requirement);
  return requirement.some((p) => can(access, p));
}

/**
 * Route → requirement. Longest matching prefix wins, so order does not matter;
 * an Admin path with no rule falls back to the `/admin` rule ("staff").
 */
export const ADMIN_ROUTE_RULES: Readonly<Record<string, AdminRequirement>> = {
  "/admin": "staff",
  "/admin/users": "users.read",
  "/admin/organizations": "organizations.read",
  "/admin/verifications": ["users.read", "organizations.read"],
  "/admin/audit": "audit.read",
  "/admin/preview": "staff",
  "/admin/preview/users": "users.read",
  "/admin/preview/organizations": "organizations.read",
  "/admin/preview/review": ["users.read", "organizations.read", "referrals.read"],
  "/admin/preview/points": "points.read",
  "/admin/preview/analytics": "analytics.read",
  "/admin/preview/audit": "audit.read",
  "/admin/preview/staff": ["admin_staff.read", "roles.read"],
  "/admin/preview/settings": "staff",
};

export function requirementFor(pathname: string): AdminRequirement {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: string | null = null;
  for (const prefix of Object.keys(ADMIN_ROUTE_RULES)) {
    const matches = path === prefix || path.startsWith(prefix + "/");
    if (matches && (best === null || prefix.length > best.length)) best = prefix;
  }
  // Callers only pass /admin paths (canAccessAdminPath denies anything else),
  // so a miss can only be an unlisted /admin path: the console door applies.
  return best ? ADMIN_ROUTE_RULES[best]! : "staff";
}

export function canAccessAdminPath(access: AdminAccess, pathname: string): boolean {
  if (!pathname.startsWith("/admin")) return false;
  return meets(access, requirementFor(pathname));
}
