import { can, type AdminAccess } from "@/lib/permissions/admin";

/**
 * UI eligibility for RBAC controls — which buttons and options to DRAW.
 *
 * These mirror the database rules (admin_can_wield_role /
 * admin_require_manageable_target / admin_role_update in
 * 20260929100001_admin_rbac_foundation.sql) so the console never offers an
 * action the server would refuse. They are presentation only: the RPCs enforce
 * every one of these rules again, and a stale or forged page gains nothing.
 */

export const SUPER_ADMIN_RANK = 100;

type RoleLike = { key: string; rank: number; status: "active" | "archived"; scopeType: string; permissions: readonly string[] };
type MemberLike = { userId: string; rank: number };

const isSuper = (a: AdminAccess) => a.rank >= SUPER_ADMIN_RANK;

/** The actor may hand out this role: active, below their rank (Super Admin excepted), every permission held. */
export function canWieldRole(access: AdminAccess, role: RoleLike): boolean {
  if (!access.isStaff || role.status !== "active") return false;
  if (!(role.rank < access.rank || isSuper(access))) return false;
  return role.permissions.every((p) => (access.permissions as readonly string[]).includes(p));
}

/** Roles offered in "Change role" / "Add role": wieldable, platform-scoped. */
export function assignableRoles<R extends RoleLike>(access: AdminAccess, roles: readonly R[]): R[] {
  return roles.filter((r) => r.scopeType === "platform" && canWieldRole(access, r));
}

/** The actor may manage this staff member: never themself; below their rank unless Super Admin. */
export function canManageMember(access: AdminAccess, callerId: string, member: MemberLike): boolean {
  if (!can(access, "admin_staff.manage") || member.userId === callerId) return false;
  return member.rank < access.rank || isSuper(access);
}

/** The actor may edit / archive this role: not Super Admin's, strictly below their rank. */
export function canEditRole(access: AdminAccess, role: Pick<RoleLike, "key" | "rank">): boolean {
  return can(access, "roles.manage") && role.key !== "super_admin" && role.rank < access.rank;
}

/**
 * The target's Admin rank as the UI may use it: 0 for a user who is not Admin Staff, the highest active
 * platform rank for staff, and `null` when the actor cannot see staff ranks at all (no `admin_staff.read`).
 */
export function staffRankOf(ranks: ReadonlyMap<string, number> | null, userId: string): number | null {
  return ranks === null ? null : (ranks.get(userId) ?? 0);
}

/**
 * The actor may suspend / restore this USER account (directory row or details header).
 *
 * Mirrors `admin_user_suspend` / `admin_user_restore`: never one's own account, and — unless the actor is a
 * Super Admin — never Admin Staff at or above the actor's own rank. `staffRank` unknown (`null`) means the
 * actor cannot see staff ranks, so the control is drawn and the database stays the only judge; a KNOWN
 * higher-or-equal rank hides it. Presentation only: the RPCs re-check every rule.
 */
export function canSuspendUser(
  access: AdminAccess,
  callerId: string,
  target: { userId: string; staffRank: number | null },
): boolean {
  if (!can(access, "users.suspend")) return false;
  if (target.userId === callerId) return false;
  if (isSuper(access)) return true;
  if (target.staffRank === null) return true;
  return target.staffRank < access.rank;
}
