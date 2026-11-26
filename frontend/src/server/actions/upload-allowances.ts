"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { UploadSubject } from "@/lib/media/upload-allowances";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Super Admin: upload allowances and exempt accounts (ADR-0032). The database judges the permission (media_limits.manage), the
 * ranges and the mandatory reason; these actions only reshape the forms and map refusals to messages.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE = /^[0-9]{1,6}$/;
const PATH = "/admin/media-limits";

const reasonOf = (fd: FormData) => String(fd.get("reason") ?? "").trim();
const badReason = (reason: string) => reason.length < 3 || reason.length > 500;

function refusal(error: { code?: string; message: string }): FormState {
  if (error.code === "42501") return { ok: false, code: "mediaLimits.errors.forbidden" };
  if (/outside the allowed range/.test(error.message)) return { ok: false, code: "mediaLimits.allowances.errors.range" };
  if (/unknown account/.test(error.message)) return { ok: false, code: "mediaLimits.allowances.errors.unknown" };
  if (/reason/.test(error.message)) return { ok: false, code: "mediaLimits.errors.reason" };
  return { ok: false, code: "mediaLimits.errors.unavailable" };
}

const changed = (data: unknown) => (data as { changed?: boolean } | null)?.changed !== false;

export async function saveUploadAllowancesAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const [uploads, attempts, quota] = ["uploads", "attempts", "quota"].map((name) => String(fd.get(name) ?? "").trim());
  if (![uploads, attempts, quota].every((v) => WHOLE.test(v!))) return { ok: false, code: "mediaLimits.allowances.errors.range" };
  const reason = reasonOf(fd);
  if (badReason(reason)) return { ok: false, code: "mediaLimits.errors.reason" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_upload_limits_set", {
    p_hourly_uploads: Number(uploads), p_hourly_attempts: Number(attempts), p_storage_quota_mb: Number(quota), p_reason: reason,
  });
  if (error) return refusal(error);
  revalidatePath(PATH);
  return { ok: true, code: changed(data) ? "mediaLimits.allowances.saved" : "mediaLimits.allowances.unchanged" };
}

export async function searchUploadSubjectsAction(query: string): Promise<{ ok: true; subjects: UploadSubject[] } | { ok: false; code: string }> {
  const q = String(query ?? "").trim().slice(0, 200);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_upload_subject_search", { p_query: q });
  if (error) return { ok: false, code: refusal(error).code! };
  return {
    ok: true,
    subjects: (data ?? []).map((r) => ({ type: r.subject_type === "organization" ? "organization" : "user", id: r.subject_id, label: r.label, detail: r.detail })),
  };
}

export async function addUploadExemptionAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const [type, id] = String(fd.get("subject") ?? "").split(":");
  if ((type !== "user" && type !== "organization") || !id || !UUID.test(id)) return { ok: false, code: "mediaLimits.allowances.errors.pick" };
  const reason = reasonOf(fd);
  if (badReason(reason)) return { ok: false, code: "mediaLimits.errors.reason" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_upload_exemption_add", { p_subject_type: type, p_subject_id: id, p_reason: reason });
  if (error) return refusal(error);
  revalidatePath(PATH);
  return { ok: true, code: changed(data) ? "mediaLimits.allowances.added" : "mediaLimits.allowances.already" };
}

export async function removeUploadExemptionAction(_previous: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { ok: false, code: "mediaLimits.allowances.errors.unknown" };
  const reason = reasonOf(fd);
  if (badReason(reason)) return { ok: false, code: "mediaLimits.errors.reason" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_upload_exemption_remove", { p_id: id, p_reason: reason });
  if (error) return refusal(error);
  revalidatePath(PATH);
  return { ok: true, code: "mediaLimits.allowances.removed" };
}
