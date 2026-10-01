import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { can, type AdminAccess } from "@/lib/permissions/admin";
import { loadUserDetail } from "@/server/queries/admin-directory";

/**
 * Admin RBAC read models (Admin Core 1A) — Staff · Roles · Permissions.
 *
 * Every read goes through a self-guarding security-definer RPC
 * (`admin_rbac_staff` → admin_staff.read, `admin_rbac_roles` /
 * `admin_rbac_permissions` → roles.read). The RBAC tables have no client grant
 * at all, so there is no other way to read them. A caller without the
 * permission gets `null` here (never a partial list), and the page renders its
 * own not-authorized state.
 */

type Client = SupabaseClient<Database>;
type ScopeType = Database["public"]["Enums"]["admin_scope_type"];

export type AdminAssignment = {
  id: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  isSystem: boolean;
  rank: number;
  roleStatus: "active" | "archived";
  scopeType: ScopeType;
  scopeOrganizationId: string | null;
  scopeOrganizationName: string | null;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  deactivationKind: string | null;
};

export type AdminStaffMember = {
  userId: string;
  displayName: string;
  /** The person's verified email contact (never the raw auth identifier). */
  email: string | null;
  accountStatus: Database["public"]["Enums"]["user_status"];
  /** Holds at least one active assignment. */
  isActive: boolean;
  firstAssignedAt: string;
  /** Supabase Auth's record of the last successful sign-in. */
  lastSignInAt: string | null;
  assignments: AdminAssignment[];
  /** Highest active platform rank (0 when disabled). */
  rank: number;
};

export type AdminRoleRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  rank: number;
  scopeType: ScopeType;
  isSystem: boolean;
  status: "active" | "archived";
  staffCount: number;
  permissions: string[];
  lockedPermissions: string[];
};

export type AdminPermissionRow = {
  key: string;
  resource: string;
  action: string;
  description: string;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Maps one `assignments` JSON element; malformed elements are dropped. */
export function mapAssignment(raw: unknown): AdminAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const id = str(a.id);
  const roleId = str(a.role_id);
  const roleKey = str(a.role_key);
  if (!id || !roleId || !roleKey) return null;
  return {
    id,
    roleId,
    roleKey,
    roleName: str(a.role_name) ?? roleKey,
    isSystem: a.is_system === true,
    rank: typeof a.rank === "number" ? a.rank : 0,
    roleStatus: a.role_status === "archived" ? "archived" : "active",
    scopeType: (str(a.scope_type) ?? "platform") as ScopeType,
    scopeOrganizationId: str(a.scope_organization_id),
    scopeOrganizationName: str(a.scope_organization_name),
    isActive: a.is_active === true,
    createdAt: str(a.created_at) ?? "",
    deactivatedAt: str(a.deactivated_at),
    deactivationKind: str(a.deactivation_kind),
  };
}

export async function listAdminStaff(supabase: Client): Promise<AdminStaffMember[] | null> {
  const { data, error } = await supabase.rpc("admin_rbac_staff");
  if (error) return null;
  return (data ?? []).map((r) => {
    const assignments = (Array.isArray(r.assignments) ? r.assignments : [])
      .map(mapAssignment)
      .filter((a): a is AdminAssignment => a !== null);
    const rank = Math.max(
      0,
      ...assignments.filter((a) => a.isActive && a.scopeType === "platform" && a.roleStatus === "active").map((a) => a.rank),
    );
    return {
      userId: r.user_id,
      displayName: r.display_name ?? "",
      email: r.email ?? null,
      accountStatus: r.account_status,
      isActive: r.is_active === true,
      firstAssignedAt: r.first_assigned_at,
      lastSignInAt: r.last_sign_in_at ?? null,
      assignments,
      rank,
    };
  });
}

export async function listAdminRoles(supabase: Client): Promise<AdminRoleRow[] | null> {
  const { data, error } = await supabase.rpc("admin_rbac_roles");
  if (error) return null;
  return (data ?? []).map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    rank: r.rank,
    scopeType: r.scope_type,
    isSystem: r.is_system,
    status: r.status,
    staffCount: r.staff_count,
    permissions: r.permissions ?? [],
    lockedPermissions: r.locked_permissions ?? [],
  }));
}

export async function listAdminPermissions(supabase: Client): Promise<AdminPermissionRow[] | null> {
  const { data, error } = await supabase.rpc("admin_rbac_permissions");
  if (error) return null;
  return (data ?? []).map((p) => ({ key: p.key, resource: p.resource, action: p.action, description: p.description }));
}

/**
 * Active staff ranks by user id, for rank-aware controls on user pages (see `canSuspendUser`).
 * `null` when the caller cannot read staff (no `admin_staff.read`) or the read fails — the UI then draws the
 * control and the database remains the judge. A user absent from the map is not Admin Staff (rank 0).
 */
export async function loadStaffRanks(supabase: Client, access: AdminAccess): Promise<Map<string, number> | null> {
  if (!can(access, "admin_staff.read")) return null;
  const staff = await listAdminStaff(supabase);
  if (!staff) return null;
  return new Map(staff.filter((s) => s.isActive).map((s) => [s.userId, s.rank]));
}

const EMAIL_LOOKUP_CAP = 50;

/**
 * `admin_rbac_staff` reads the email from `public.contacts`, which canonical email + password accounts do not
 * have (only the legacy passwordless flow wrote it). For those members, reuse the SAME source the Users directory
 * uses — `admin_user_detail`, which returns `app.user_facing_email(auth.users.email)` — so the Staff list shows the
 * real sign-in email. Needs `users.read`; without it (or on any failure) the member keeps `null`. Never creates a
 * contacts row and never calls the Auth Admin API.
 */
export async function withAccountEmails(
  supabase: Client,
  access: AdminAccess,
  staff: AdminStaffMember[],
): Promise<AdminStaffMember[]> {
  if (!can(access, "users.read")) return staff;
  const missing = staff.filter((s) => !s.email).slice(0, EMAIL_LOOKUP_CAP);
  if (missing.length === 0) return staff;
  const found = new Map<string, string>();
  await Promise.all(
    missing.map(async (s) => {
      const detail = await loadUserDetail(supabase, s.userId);
      if (detail.ok && detail.data?.email) found.set(s.userId, detail.data.email);
    }),
  );
  return staff.map((s) => (s.email || !found.has(s.userId) ? s : { ...s, email: found.get(s.userId)! }));
}
