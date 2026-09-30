"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { FormState } from "@/server/actions/sales-forms";
import { mapOperationsError } from "@/server/actions/admin-operations-errors";
import { FOLLOW_UP_TYPES, type FollowUpType } from "@/features/admin-preview/operations-mappers";
import { parseDueAt } from "@/features/admin-preview/due-at";

/**
 * Admin Core Phase 1B-B mutations — suspension, Admin Notes, Follow-ups,
 * Cases and organization duplicate resolution. Nothing is decided here: each
 * action forwards the caller's JWT to ONE self-guarding RPC, which enforces
 * the permission and platform scope, the rank / self / last-Super-Admin rules,
 * idempotency and the audit trail in one transaction. This layer only shapes
 * input and maps the outcome to a translation KEY.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECTS = ["user", "organization"] as const;
type Subject = (typeof SUBJECTS)[number];

function text(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function uuid(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  return UUID.test(v) ? v : null;
}
function subject(fd: FormData): { type: Subject; id: string } | null {
  const type = text(fd, "subjectType") as Subject;
  const id = uuid(fd, "subjectId");
  return SUBJECTS.includes(type) && id ? { type, id } : null;
}
function detailPath(type: Subject, id: string): string {
  return type === "user" ? `/admin/preview/users/${id}` : `/admin/preview/organizations/${id}`;
}

async function run(
  paths: string[],
  call: (s: Awaited<ReturnType<typeof getServerSupabase>>) => PromiseLike<{ error: unknown }>,
  okCode: string,
): Promise<FormState> {
  const supabase = await getServerSupabase();
  const { error } = await call(supabase);
  if (error) return { ok: false, code: mapOperationsError(error) };
  for (const p of paths) revalidatePath(p);
  return { ok: true, code: okCode };
}

/* ---------------------------------------------------------------- suspension */

export async function suspendSubjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  if (!s) return { ok: false, code: "states.genericRetry" };
  const reason = text(fd, "reason");
  if (!reason) return { ok: false, code: "admin.preview.ops.error.reasonRequired", fieldErrors: { reason: "admin.preview.ops.error.reasonRequired" } };
  const directory = s.type === "user" ? "/admin/preview/users" : "/admin/preview/organizations";
  return run(
    [directory, detailPath(s.type, s.id)],
    (sb) =>
      s.type === "user"
        ? sb.rpc("admin_user_suspend", { p_user_id: s.id, p_reason: reason })
        : sb.rpc("admin_organization_suspend", { p_organization_id: s.id, p_reason: reason }),
    "admin.preview.ops.done.suspended",
  );
}

export async function restoreSubjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  if (!s) return { ok: false, code: "states.genericRetry" };
  const reason = text(fd, "reason") || undefined;
  const directory = s.type === "user" ? "/admin/preview/users" : "/admin/preview/organizations";
  return run(
    [directory, detailPath(s.type, s.id)],
    (sb) =>
      s.type === "user"
        ? sb.rpc("admin_user_restore", { p_user_id: s.id, p_reason: reason })
        : sb.rpc("admin_organization_restore", { p_organization_id: s.id, p_reason: reason }),
    "admin.preview.ops.done.restored",
  );
}

/* --------------------------------------------------------------------- notes */

export async function addNoteAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  if (!s) return { ok: false, code: "states.genericRetry" };
  const body = text(fd, "body");
  if (!body) return { ok: false, code: "admin.preview.ops.error.noteRequired", fieldErrors: { body: "admin.preview.ops.error.noteRequired" } };
  if (body.length > 4000) return { ok: false, code: "admin.preview.ops.error.tooLong", fieldErrors: { body: "admin.preview.ops.error.tooLong" } };
  return run(
    [detailPath(s.type, s.id)],
    (sb) => sb.rpc("admin_note_add", { p_subject_type: s.type, p_subject_id: s.id, p_body: body }),
    "admin.preview.ops.done.noteAdded",
  );
}

/* ---------------------------------------------------------------- follow-ups */

export async function logFollowUpAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  if (!s) return { ok: false, code: "states.genericRetry" };
  const type = text(fd, "actionType") as FollowUpType;
  if (!FOLLOW_UP_TYPES.includes(type)) return { ok: false, code: "states.genericRetry" };
  const outcome = text(fd, "outcome");
  if (!outcome) return { ok: false, code: "admin.preview.ops.error.outcomeRequired", fieldErrors: { outcome: "admin.preview.ops.error.outcomeRequired" } };
  const due = parseDueAt(text(fd, "dueDate"), text(fd, "dueTime"));
  if (due === "invalid") return { ok: false, code: "admin.preview.ops.error.dueInvalid", fieldErrors: { due: "admin.preview.ops.error.dueInvalid" } };
  const assignee = text(fd, "assignedTo");
  if (assignee && !UUID.test(assignee)) return { ok: false, code: "admin.preview.ops.error.assignee" };
  return run(
    [detailPath(s.type, s.id)],
    (sb) =>
      sb.rpc("admin_follow_up_log", {
        p_subject_type: s.type,
        p_subject_id: s.id,
        p_action_type: type,
        p_outcome: outcome,
        p_due_at: due ?? undefined,
        p_assigned_to: assignee || undefined,
      }),
    "admin.preview.ops.done.followUpLogged",
  );
}

export async function completeFollowUpAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  const id = uuid(fd, "followUpId");
  if (!s || !id) return { ok: false, code: "states.genericRetry" };
  return run(
    [detailPath(s.type, s.id)],
    (sb) => sb.rpc("admin_follow_up_complete", { p_follow_up_id: id }),
    "admin.preview.ops.done.followUpCompleted",
  );
}

/* --------------------------------------------------------------------- cases */

export async function createCaseAction(_p: FormState, fd: FormData): Promise<FormState> {
  const s = subject(fd);
  if (!s) return { ok: false, code: "states.genericRetry" };
  const title = text(fd, "title");
  const details = text(fd, "details");
  if (!title) return { ok: false, code: "admin.preview.ops.error.titleRequired", fieldErrors: { title: "admin.preview.ops.error.titleRequired" } };
  if (!details) return { ok: false, code: "admin.preview.ops.error.detailsRequired", fieldErrors: { details: "admin.preview.ops.error.detailsRequired" } };
  return run(
    [detailPath(s.type, s.id)],
    (sb) =>
      sb.rpc("admin_case_create", {
        p_subject_type: s.type,
        p_subject_id: s.id,
        p_title: title,
        p_details: details,
        p_contact_name: text(fd, "contactName") || undefined,
        p_contact_phone: text(fd, "contactPhone") || undefined,
        p_contact_email: text(fd, "contactEmail") || undefined,
      }),
    "admin.preview.ops.done.caseCreated",
  );
}

/* ---------------------------------------------------------------- duplicates */

export async function resolveDuplicateAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = uuid(fd, "organizationId");
  const otherId = uuid(fd, "otherId");
  const mode = text(fd, "mode");
  const reason = text(fd, "reason");
  if (!orgId || !otherId || (mode !== "link" && mode !== "dismiss")) return { ok: false, code: "states.genericRetry" };
  if (!reason) return { ok: false, code: "admin.preview.ops.error.reasonRequired", fieldErrors: { reason: "admin.preview.ops.error.reasonRequired" } };
  // "link" = THIS organization is the duplicate; the candidate is the existing record.
  return run(
    [detailPath("organization", orgId), detailPath("organization", otherId)],
    (sb) =>
      mode === "link"
        ? sb.rpc("admin_organization_link_duplicate", { p_duplicate_org_id: orgId, p_canonical_org_id: otherId, p_reason: reason })
        : sb.rpc("admin_organization_dismiss_duplicate", { p_organization_id: orgId, p_other_org_id: otherId, p_reason: reason }),
    mode === "link" ? "admin.preview.ops.done.linked" : "admin.preview.ops.done.dismissed",
  );
}
