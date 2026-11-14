"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { FormState } from "@/server/actions/sales-forms";
import {
  buildEditPatch,
  ORG_EDIT_FIELDS,
  ORG_REMOVABLE_MEDIA,
  USER_EDIT_FIELDS,
  USER_REMOVABLE_MEDIA,
} from "@/lib/admin/edit/fields";

/**
 * Admin edit, Option A. Nothing is decided here: the form is reduced to an ALLOW-LISTED patch (a forged form that carries a
 * phone, email, legal name, national id, bank detail, type, status, slug, id ... is refused whole, before any database call),
 * a reason is required, and ONE self-guarding RPC applies it with the caller's own session. The RPC enforces the permission
 * (Administrator and above), the self / rank rules, the allow-list again, the masked immutable audit row and the notification.
 * No service-role client, no direct table write.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const K = "admin.profileEdit.error";

type PgLikeError = { code?: string; message?: string };
export function mapEditError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const msg = (e.message ?? "").toLowerCase();
  if (msg.includes("a reason is required") || msg.includes("reason is too long")) return `${K}.reasonRequired`;
  if (msg.includes("field not editable") || msg.includes("media can only be removed")) return `${K}.notEditable`;
  if (msg.includes("your own account")) return `${K}.self`;
  if (msg.includes("at or above your own rank")) return `${K}.rank`;
  if (msg.includes("not found")) return `${K}.notFound`;
  if (e.code === "22023") return `${K}.invalid`;
  if (e.code === "42501") return `${K}.denied`;
  return "states.genericRetry";
}

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

async function run(
  fd: FormData,
  fields: Parameters<typeof buildEditPatch>[1],
  media: readonly string[],
  call: (
    supabase: Awaited<ReturnType<typeof getServerSupabase>>,
    id: string,
    changes: Record<string, unknown>,
    reason: string,
  ) => PromiseLike<{ data: unknown; error: unknown }>,
  paths: (id: string) => string[],
): Promise<FormState> {
  const id = field(fd, "subjectId");
  if (!UUID.test(id)) return { ok: false, code: "states.genericRetry" };
  const patch = buildEditPatch(fd, fields, media);
  if (!patch.ok) {
    if (patch.code === "notEditable") return { ok: false, code: `${K}.notEditable` };
    return { ok: false, code: `${K}.invalid`, ...(patch.field ? { fieldErrors: { [patch.field]: `${K}.invalid` } } : {}) };
  }
  const reason = field(fd, "reason");
  if (!reason) return { ok: false, code: `${K}.reasonRequired`, fieldErrors: { reason: `${K}.reasonRequired` } };
  if (reason.length > 500) return { ok: false, code: `${K}.reasonRequired`, fieldErrors: { reason: `${K}.reasonRequired` } };
  const supabase = await getServerSupabase();
  const { data, error } = await call(supabase, id, patch.changes, reason);
  if (error) return { ok: false, code: mapEditError(error) };
  for (const p of paths(id)) revalidatePath(p);
  const changed = (data as { changed?: boolean } | null)?.changed === true;
  return { ok: true, code: changed ? "admin.profileEdit.done" : "admin.profileEdit.noChange" };
}

export async function editUserProfileAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(
    fd,
    USER_EDIT_FIELDS,
    USER_REMOVABLE_MEDIA,
    (sb, id, changes, reason) => sb.rpc("admin_user_edit_profile", { p_user_id: id, p_changes: changes as never, p_reason: reason }),
    (id) => ["/admin/users", `/admin/users/${id}`, `/admin/users/${id}/edit`],
  );
}

export async function editOrganizationAction(_p: FormState, fd: FormData): Promise<FormState> {
  return run(
    fd,
    ORG_EDIT_FIELDS,
    ORG_REMOVABLE_MEDIA,
    (sb, id, changes, reason) => sb.rpc("admin_organization_edit", { p_organization_id: id, p_changes: changes as never, p_reason: reason }),
    (id) => ["/admin/organizations", `/admin/organizations/${id}`, `/admin/organizations/${id}/edit`],
  );
}
