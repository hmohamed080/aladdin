"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { FormState } from "@/server/actions/sales-forms";
import { mapRbacError } from "@/server/actions/admin-rbac-errors";

/**
 * Admin RBAC mutations (Admin Core 1A). Nothing is decided here: each action
 * forwards the caller's JWT to one self-guarding RPC, which enforces the
 * permission (`roles.manage` / `admin_staff.manage`), the rank and permission
 * ceilings, the no-self-management rule, the last-Super-Admin rule, and writes
 * the audit event — all in one transaction. This layer only shapes input and
 * maps the outcome to a translation KEY (never a raw database string).
 */

const STAFF_PATH = "/admin/preview/staff";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ["platform", "organization", "branch", "user"] as const;
type Scope = (typeof SCOPES)[number];

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function uuid(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  return UUID.test(v) ? v : null;
}
function rank(fd: FormData): number | null {
  const n = Number(text(fd, "rank"));
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}
function permissions(fd: FormData): string[] {
  return Array.from(new Set(fd.getAll("permissions").filter((v): v is string => typeof v === "string" && v !== "")));
}
function reason(fd: FormData): string | undefined {
  return text(fd, "reason") || undefined;
}

async function run(call: (s: Awaited<ReturnType<typeof getServerSupabase>>) => PromiseLike<{ error: unknown }>, okCode: string): Promise<FormState> {
  const supabase = await getServerSupabase();
  const { error } = await call(supabase);
  if (error) return { ok: false, code: mapRbacError(error) };
  revalidatePath(STAFF_PATH);
  return { ok: true, code: okCode };
}

export async function createRoleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const name = text(fd, "name");
  if (!name) return { ok: false, code: "admin.rbac.error.nameRequired", fieldErrors: { name: "admin.rbac.error.nameRequired" } };
  const r = rank(fd);
  if (r === null) return { ok: false, code: "admin.rbac.error.rankInvalid", fieldErrors: { rank: "admin.rbac.error.rankInvalid" } };
  const scope = text(fd, "scope") as Scope;
  if (!SCOPES.includes(scope)) return { ok: false, code: "states.genericRetry" };
  return run(
    (s) =>
      s.rpc("admin_role_create", {
        p_name: name,
        p_description: text(fd, "description"),
        p_rank: r,
        p_scope_type: scope,
        p_permissions: permissions(fd),
        p_reason: reason(fd),
      }),
    "admin.rbac.saved",
  );
}

export async function updateRoleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const roleId = uuid(fd, "roleId");
  if (!roleId) return { ok: false, code: "states.genericRetry" };
  const name = text(fd, "name");
  if (!name) return { ok: false, code: "admin.rbac.error.nameRequired", fieldErrors: { name: "admin.rbac.error.nameRequired" } };
  const r = rank(fd);
  if (r === null) return { ok: false, code: "admin.rbac.error.rankInvalid", fieldErrors: { rank: "admin.rbac.error.rankInvalid" } };
  return run(
    (s) =>
      s.rpc("admin_role_update", {
        p_role_id: roleId,
        p_name: name,
        p_description: text(fd, "description"),
        p_rank: r,
        p_permissions: permissions(fd),
        p_reason: reason(fd),
      }),
    "admin.rbac.saved",
  );
}

export async function setRoleArchivedAction(_p: FormState, fd: FormData): Promise<FormState> {
  const roleId = uuid(fd, "roleId");
  if (!roleId) return { ok: false, code: "states.genericRetry" };
  const archived = text(fd, "archived") === "true";
  return run(
    (s) => s.rpc("admin_role_set_archived", { p_role_id: roleId, p_archived: archived, p_reason: reason(fd) }),
    archived ? "admin.rbac.archived" : "admin.rbac.restored",
  );
}

export async function changeStaffRoleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const userId = uuid(fd, "userId");
  const roleId = uuid(fd, "roleId");
  if (!userId || !roleId) return { ok: false, code: "admin.rbac.error.roleRequired", fieldErrors: { roleId: "admin.rbac.error.roleRequired" } };
  return run(
    (s) => s.rpc("admin_staff_change_role", { p_user_id: userId, p_role_id: roleId, p_reason: reason(fd) }),
    "admin.rbac.saved",
  );
}

export async function assignRoleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const userId = uuid(fd, "userId");
  const roleId = uuid(fd, "roleId");
  if (!userId || !roleId) return { ok: false, code: "admin.rbac.error.roleRequired", fieldErrors: { roleId: "admin.rbac.error.roleRequired" } };
  return run(
    (s) =>
      s.rpc("admin_staff_assign_role", {
        p_user_id: userId,
        p_role_id: roleId,
        p_scope_type: "platform",
        p_reason: reason(fd),
      }),
    "admin.rbac.saved",
  );
}

export async function unassignRoleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const assignmentId = uuid(fd, "assignmentId");
  if (!assignmentId) return { ok: false, code: "states.genericRetry" };
  return run(
    (s) => s.rpc("admin_staff_unassign", { p_assignment_id: assignmentId, p_reason: reason(fd) }),
    "admin.rbac.saved",
  );
}

export async function setStaffDisabledAction(_p: FormState, fd: FormData): Promise<FormState> {
  const userId = uuid(fd, "userId");
  if (!userId) return { ok: false, code: "states.genericRetry" };
  const disabled = text(fd, "disabled") === "true";
  const why = reason(fd);
  // Mirrors the RPC's own rule so the dialog can point at the field; the RPC
  // still refuses a blank reason on its own.
  if (disabled && !why) return { ok: false, code: "admin.rbac.error.reasonRequired", fieldErrors: { reason: "admin.rbac.error.reasonRequired" } };
  return run(
    (s) => s.rpc("admin_staff_set_disabled", { p_user_id: userId, p_disabled: disabled, p_reason: why }),
    disabled ? "admin.rbac.disabled" : "admin.rbac.enabled",
  );
}
