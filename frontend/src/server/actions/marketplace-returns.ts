"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import { returnErrorCode, type ReturnDocument, type ReturnKind, type ReturnSettings } from "@/features/marketplace-returns/contract";
import { isMarketplaceReturnKey, MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, removeMedia, verifyPendingMedia } from "@/server/storage/media";
import { readableMediaUrl } from "@/server/storage/edge-ticket";
import { imageMaxBytes } from "@/server/media/limits";
import type { Json } from "@/types/database.types";

/**
 * Marketplace returns and exchanges (PR 15). Thin wrappers over the SECURITY DEFINER RPCs of migration
 * 20261125130002, run under the caller's OWN session: who may request, decide, receive, refund or review is
 * decided in the database (the UI is never the gate). Evidence photos are private; their keys and bytes are never logged.
 * No money moves here: a refund is a record the showroom makes and the buyer confirms.
 */
export type ReturnResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const fail = (error: { message?: string } | null): SellerActionError => {
  const e = parseSellerError(error?.message);
  return { ...e, code: returnErrorCode(e.code) };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BUYER_RETURNS = "/market/returns";
const SELLER_RETURNS = "/showroom/marketplace/returns";
const ADMIN_RETURNS = "/admin/marketplace/returns";

type Doc = { return: ReturnDocument };

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------
/** Evidence photo ticket (photos only, at most 6 per request): the database mints the key, the media layer grants the upload. */
export async function requestEvidenceUploadAction(
  orderId: string,
  contentType: string,
  expectedBytes: number,
): Promise<ReturnResult<{ evidenceId: string; objectKey: string; grant: UploadGrant }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(contentType)) return { ok: false, code: "image_type_invalid" };
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > (await imageMaxBytes("marketplace"))) {
    return { ok: false, code: "file_too_large" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_return_request_upload", { p_order_id: orderId, p_content_type: contentType });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { evidence_id: string; object_key: string };
  if (!isMarketplaceReturnKey(r.object_key)) return { ok: false, code: "unexpected" };
  try {
    return { ok: true, evidenceId: r.evidence_id, objectKey: r.object_key, grant: await authorizeMediaUpload(supabase, "marketplace", r.object_key, expectedBytes) };
  } catch {
    return { ok: false, code: "upload_failed" };
  }
}

/** Verifies the stored bytes (central verifier), then marks the photo ready to be attached to a request. */
export async function confirmEvidenceAction(
  evidenceId: string,
  objectKey: string,
): Promise<ReturnResult<{ evidence: { id: string; object_key: string; created_at: string }[] }>> {
  if (!UUID.test(evidenceId) || !isMarketplaceReturnKey(objectKey) || !objectKey.includes(`/${evidenceId}.`)) return { ok: false, code: "upload_not_found" };
  const supabase = await getServerSupabase();
  try {
    await verifyPendingMedia(supabase, "marketplace", objectKey);
  } catch {
    return { ok: false, code: "image_content_invalid" };
  }
  const { data, error } = await supabase.rpc("marketplace_buyer_return_evidence_confirm", { p_evidence_id: evidenceId });
  if (error || !data) return { ok: false, ...fail(error) };
  return { ok: true, evidence: (data as { evidence: { id: string; object_key: string; created_at: string }[] }).evidence };
}

/**
 * Removes a photo that no request holds. The database marks it for deletion (only its uploader may); deleting the bytes now is
 * best effort, the central media cleanup removes whatever is left.
 */
export async function removeEvidenceAction(evidenceId: string): Promise<ReturnResult<{ removed: true }>> {
  if (!UUID.test(evidenceId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_return_evidence_remove", { p_evidence_id: evidenceId });
  if (error || !data) return { ok: false, ...fail(error) };
  const key = (data as { object_key?: string }).object_key;
  if (key && isMarketplaceReturnKey(key)) {
    try {
      await removeMedia(supabase, "marketplace", key);
    } catch {
      // left in the cleanup queue
    }
  }
  return { ok: true, removed: true };
}

/** A short-lived URL of one evidence photo for whoever may read it right now (the media resolver re-checks on every call). */
export async function evidenceUrlAction(objectKey: string): Promise<ReturnResult<{ url: string }>> {
  if (!isMarketplaceReturnKey(objectKey)) return { ok: false, code: "not_found" };
  try {
    return { ok: true, url: await readableMediaUrl(await getServerSupabase(), "marketplace", objectKey) };
  } catch {
    return { ok: false, code: "not_found" };
  }
}

export type CreateReturnInput = {
  orderId: string;
  kind: ReturnKind;
  lines: { item_id: string; quantity: number }[];
  reasonPresetId: string;
  note: string;
  evidenceIds: string[];
  idempotencyKey: string;
};

export async function createReturnAction(input: CreateReturnInput): Promise<ReturnResult<Doc>> {
  if (!UUID.test(input.orderId) || !UUID.test(input.reasonPresetId) || !input.evidenceIds.every((id) => UUID.test(id))) return { ok: false, code: "invalid_payload" };
  if (input.kind !== "return" && input.kind !== "exchange") return { ok: false, code: "invalid_payload" };
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 50) return { ok: false, code: "invalid_payload" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_return_create", {
    p_order_id: input.orderId,
    p_kind: input.kind,
    p_lines: input.lines.map((l) => ({ item_id: String(l.item_id), quantity: Math.round(Number(l.quantity)) })) as unknown as Json,
    p_reason_preset_id: input.reasonPresetId,
    p_note: input.note.trim().slice(0, 500),
    p_evidence_ids: input.evidenceIds,
    p_remedy: input.kind === "return" ? "refund" : "exchange",
    p_idempotency_key: input.idempotencyKey,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_RETURNS);
  revalidatePath(`/market/orders/${input.orderId}`);
  return { ok: true, return: data as unknown as ReturnDocument };
}

async function buyerCall(fn: "marketplace_buyer_return_cancel" | "marketplace_buyer_refund_confirm", id: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc(fn, { p_return_id: id });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}
export async function cancelReturnAction(id: string) {
  return buyerCall("marketplace_buyer_return_cancel", id);
}
export async function confirmRefundAction(id: string) {
  return buyerCall("marketplace_buyer_refund_confirm", id);
}

export async function markReturnShippedAction(id: string, tracking: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_return_mark_shipped", { p_return_id: id, p_tracking: tracking.trim().slice(0, 64) || undefined });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

/** The buyer or the showroom escalates to the admin queue (a written reason is required). */
export async function fileReturnComplaintAction(id: string, note: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_return_complaint_file", { p_return_id: id, p_note: note.trim().slice(0, 500) });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_RETURNS);
  revalidatePath(SELLER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

// ---------------------------------------------------------------------------
// Showroom
// ---------------------------------------------------------------------------
export type DecideInput = {
  decision: "approve" | "reject" | "propose_partial";
  presetId?: string | null;
  messageAr?: string;
  messageEn?: string;
  partialRefundEgp?: number | null;
};

export async function decideReturnAction(id: string, input: DecideInput): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_return_decide", {
    p_return_id: id,
    p_decision: input.decision,
    p_preset_id: input.presetId && UUID.test(input.presetId) ? input.presetId : undefined,
    p_message_ar: input.messageAr?.trim().slice(0, 300) || undefined,
    p_message_en: input.messageEn?.trim().slice(0, 300) || undefined,
    p_partial_refund_egp: input.partialRefundEgp ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

export async function receiveReturnAction(id: string, sellable: { item_id: string; sellable: boolean }[]): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_return_receive", { p_return_id: id, p_sellable: sellable as unknown as Json });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

export async function recordRefundAction(id: string, amountEgp: number, referenceNote: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id) || !Number.isFinite(amountEgp) || amountEgp <= 0) return { ok: false, code: "invalid_payload" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_refund_record", {
    p_return_id: id,
    p_amount_egp: amountEgp,
    p_reference_note: referenceNote.trim().slice(0, 300) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

export async function fulfilExchangeAction(id: string, note: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_exchange_fulfil", { p_return_id: id, p_note: note.trim().slice(0, 300) || undefined });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

export async function saveReturnSettingsAction(organizationId: string, generalDays: number, defectDays: number): Promise<ReturnResult<{ settings: ReturnSettings }>> {
  if (!UUID.test(organizationId)) return { ok: false, code: "not_permitted" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_return_settings_save", {
    p_organization_id: organizationId,
    p_settings: { general_days: String(Math.round(generalDays)), defect_days: String(Math.round(defectDays)) } as unknown as Json,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath("/showroom/marketplace/return-policy");
  return { ok: true, settings: data as unknown as ReturnSettings };
}

/** The per-product "made to order, not returnable" flag (disclosed before payment). */
export async function setNonReturnableAction(organizationId: string, productId: string, nonReturnable: boolean): Promise<ReturnResult<{ nonReturnable: boolean }>> {
  if (!UUID.test(organizationId) || !UUID.test(productId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_product_returnability_set", {
    p_organization_id: organizationId,
    p_product_id: productId,
    p_non_returnable: nonReturnable,
  });
  if (error || data === null || data === undefined) return { ok: false, ...fail(error) };
  revalidatePath("/showroom/marketplace/products");
  return { ok: true, nonReturnable: Boolean(data) };
}

// ---------------------------------------------------------------------------
// Admin (permission marketplace_returns.review, re-checked by every RPC)
// ---------------------------------------------------------------------------
export async function adminRemindSellerAction(id: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_return_remind_seller", { p_return_id: id });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(ADMIN_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}

export async function adminDecideReturnAction(id: string, decision: "approve" | "reject", note: string, messageAr: string, messageEn: string): Promise<ReturnResult<Doc>> {
  if (!UUID.test(id) || (decision !== "approve" && decision !== "reject")) return { ok: false, code: "invalid_payload" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_return_decide", {
    p_return_id: id,
    p_decision: decision,
    p_note: note.trim().slice(0, 500),
    p_message_ar: messageAr.trim().slice(0, 300) || undefined,
    p_message_en: messageEn.trim().slice(0, 300) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(ADMIN_RETURNS);
  return { ok: true, return: data as unknown as ReturnDocument };
}
