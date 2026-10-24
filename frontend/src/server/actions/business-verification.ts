"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  BV_BUCKET,
  BV_NOTE_MAX,
  BV_REASON_MAX,
  UUID_SHAPE,
  isBvContentType,
  isBvDocType,
  isBvKey,
  mapBvError,
  BV_MAX_BYTES,
} from "@/lib/business-verification/contract";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * Business verification actions. Nothing is decided here: every rule (who may upload, submit, review or
 * approve; the state machine; the own-organization guard; the audit and the notifications) lives in the
 * business_verification_* RPCs and the private bucket's storage policies. These forward the caller's JWT
 * and map the outcome to a translation key.
 */

const SHOWROOM_PATH = "/showroom/verification";
const ADMIN_PATH = "/admin/business-verification";

export type BvTicket = { ok: true; key: string } | { ok: false; code: string };
export type BvResult = { ok: true } | { ok: false; code: string };

export async function requestBvUploadAction(input: {
  orgId: string;
  docType: string;
  contentType: string;
  sizeBytes: number;
  fileName: string;
}): Promise<BvTicket> {
  if (!UUID_SHAPE.test(input.orgId) || !isBvDocType(input.docType)) return { ok: false, code: "states.genericRetry" };
  if (!isBvContentType(input.contentType)) return { ok: false, code: "businessVerification.errors.fileType" };
  if (!(input.sizeBytes > 0 && input.sizeBytes <= BV_MAX_BYTES)) return { ok: false, code: "businessVerification.errors.fileSize" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("business_verification_document_request_upload", {
    p_org_id: input.orgId,
    p_doc_type: input.docType,
    p_content_type: input.contentType,
    p_size_bytes: Math.trunc(input.sizeBytes),
    p_file_name: input.fileName.slice(0, 120),
  });
  if (error || typeof data !== "string" || !isBvKey(data)) return { ok: false, code: error ? mapBvError(error.message) : "businessVerification.errors.upload" };
  return { ok: true, key: data };
}

/**
 * Confirm only AFTER the browser has uploaded: the database never reads the byte store, so the existence
 * check lives here, through the caller's own Storage access (the same pattern as product images).
 */
export async function confirmBvUploadAction(key: string): Promise<BvResult> {
  if (!isBvKey(key)) return { ok: false, code: "businessVerification.errors.upload" };
  const supabase = await getServerSupabase();
  const slash = key.lastIndexOf("/");
  const { data: listed, error: listError } = await supabase.storage
    .from(BV_BUCKET)
    .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 5 });
  if (listError || !(listed ?? []).some((o) => o.name === key.slice(slash + 1))) {
    return { ok: false, code: "businessVerification.errors.upload" };
  }
  const { error } = await supabase.rpc("business_verification_document_confirm", { p_object_key: key });
  if (error) return { ok: false, code: mapBvError(error.message) };
  revalidatePath(SHOWROOM_PATH);
  return { ok: true };
}

export async function removeBvDocumentAction(documentId: string): Promise<BvResult> {
  if (!UUID_SHAPE.test(documentId)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("business_verification_document_remove", { p_document_id: documentId });
  if (error) return { ok: false, code: mapBvError(error.message) };
  // Best-effort byte cleanup after the metadata change committed; the storage policy allows it only
  // for an unsubmitted document of an organization the caller manages.
  if (typeof key === "string" && isBvKey(key)) await supabase.storage.from(BV_BUCKET).remove([key]);
  revalidatePath(SHOWROOM_PATH);
  return { ok: true };
}

function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function submitBvAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = field(fd, "orgId");
  const note = field(fd, "note");
  if (!UUID_SHAPE.test(orgId)) return { ok: false, code: "states.genericRetry" };
  if (note.length > BV_NOTE_MAX) return { ok: false, code: "businessVerification.errors.noteTooLong" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("business_verification_submit", { p_org_id: orgId, p_note: note || undefined });
  if (error) return { ok: false, code: mapBvError(error.message) };
  revalidatePath(SHOWROOM_PATH);
  return { ok: true, code: "businessVerification.owner.submitted" };
}

type Decision = "start" | "request_info" | "approve" | "reject";
const RPC: Record<Exclude<Decision, "start">, "business_verification_request_info" | "business_verification_approve" | "business_verification_reject"> = {
  request_info: "business_verification_request_info",
  approve: "business_verification_approve",
  reject: "business_verification_reject",
};

async function decide(decision: Decision, fd: FormData): Promise<FormState> {
  const id = field(fd, "id");
  if (!UUID_SHAPE.test(id)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  if (decision === "start") {
    const { error } = await supabase.rpc("business_verification_start_review", { p_verification_id: id });
    if (error) return { ok: false, code: mapBvError(error.message) };
  } else {
    const reason = field(fd, "reason");
    if (reason.length < 1 || reason.length > BV_REASON_MAX) return { ok: false, code: "businessVerification.errors.reasonRequired" };
    const { error } = await supabase.rpc(RPC[decision], { p_verification_id: id, p_reason: reason });
    if (error) return { ok: false, code: mapBvError(error.message) };
  }
  revalidatePath(ADMIN_PATH);
  revalidatePath(`${ADMIN_PATH}/${id}`);
  return { ok: true, code: `businessVerification.admin.done.${decision}` };
}

export async function startBvReviewAction(_p: FormState, fd: FormData): Promise<FormState> {
  return decide("start", fd);
}
export async function requestBvInfoAction(_p: FormState, fd: FormData): Promise<FormState> {
  return decide("request_info", fd);
}
export async function approveBvAction(_p: FormState, fd: FormData): Promise<FormState> {
  return decide("approve", fd);
}
export async function rejectBvAction(_p: FormState, fd: FormData): Promise<FormState> {
  return decide("reject", fd);
}
