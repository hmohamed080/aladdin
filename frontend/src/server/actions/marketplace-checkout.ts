"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import { isMarketplaceProofKey, MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, verifyPendingMedia } from "@/server/storage/media";
import { imageMaxBytes } from "@/server/media/limits";
import type { CheckoutConfirmed, CheckoutPrepared, CheckoutPrepareInput } from "@/features/marketplace-checkout/checkout-model";
import type { Json } from "@/types/database.types";

/**
 * Checkout v2 writers (Marketplace PR 12). Thin wrappers over the SECURITY DEFINER RPCs, run under the caller's own
 * session. The browser sends NO price: the database prices the quote, binds a receipt to the checkout session and
 * places the order idempotently. Receipts, addresses and phones are never logged here.
 */
export type CheckoutResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: { message?: string } | null): SellerActionError => parseSellerError(error?.message);

export async function prepareCheckoutAction(input: CheckoutPrepareInput): Promise<CheckoutResult<{ prepared: CheckoutPrepared }>> {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (lines.length === 0 || lines.length > 50) return { ok: false, code: "invalid_lines" };
  if (input.fulfilment !== "delivery" && input.fulfilment !== "pickup") return { ok: false, code: "invalid_fulfilment" };
  if (!["cod", "instapay_full", "instapay_deposit"].includes(input.payment)) return { ok: false, code: "invalid_payment" };
  if (input.addressId && !UUID.test(input.addressId)) return { ok: false, code: "address_required" };
  if (input.sessionId && !UUID.test(input.sessionId)) return { ok: false, code: "session_not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_checkout_prepare", {
    p_lines: lines.map((l) => ({ slug: String(l.slug), sku: String(l.sku), qty: Math.round(Number(l.qty)) })) as unknown as Json,
    p_fulfilment: input.fulfilment,
    p_address_id: input.fulfilment === "delivery" && input.addressId ? input.addressId : undefined,
    p_delivery_speed: input.speed === "next_day" ? "next_day" : "standard",
    p_payment_method: input.payment,
    p_session_id: input.sessionId ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  return { ok: true, prepared: data as unknown as CheckoutPrepared };
}

export async function confirmCheckoutAction(
  sessionId: string,
  quoteHash: string,
  idempotencyKey: string,
  note: string,
): Promise<CheckoutResult<{ confirmed: CheckoutConfirmed }>> {
  if (!UUID.test(sessionId) || !/^[0-9a-f]{64}$/.test(quoteHash) || typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return { ok: false, code: "invalid_payload" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_checkout_confirm", {
    p_session_id: sessionId,
    p_quote_hash: quoteHash,
    p_idempotency_key: idempotencyKey,
    p_buyer_note: note.trim().slice(0, 500) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath("/market/orders");
  return { ok: true, confirmed: data as unknown as CheckoutConfirmed };
}

/** Receipt upload ticket for a checkout session (before the order exists): the database mints the key, the media layer grants the upload. */
export async function requestReceiptUploadAction(
  sessionId: string,
  contentType: string,
  expectedBytes: number,
): Promise<CheckoutResult<{ proofId: string; objectKey: string; grant: UploadGrant }>> {
  if (!UUID.test(sessionId)) return { ok: false, code: "session_not_found" };
  if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(contentType)) return { ok: false, code: "image_type_invalid" };
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > (await imageMaxBytes("marketplace"))) {
    return { ok: false, code: "file_too_large" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_checkout_receipt_request_upload", {
    p_session_id: sessionId,
    p_content_type: contentType,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { proof_id: string; object_key: string };
  if (!isMarketplaceProofKey(r.object_key)) return { ok: false, code: "unexpected" };
  try {
    return { ok: true, proofId: r.proof_id, objectKey: r.object_key, grant: await authorizeMediaUpload(supabase, "marketplace", r.object_key, expectedBytes) };
  } catch {
    return { ok: false, code: "upload_failed" };
  }
}

/** Verifies the stored bytes (central verifier) and only then attaches the receipt to the session. */
export async function confirmReceiptAction(proofId: string, objectKey: string): Promise<CheckoutResult<{ receiptOk: boolean }>> {
  if (!UUID.test(proofId) || !isMarketplaceProofKey(objectKey) || !objectKey.includes(`/${proofId}.`)) return { ok: false, code: "upload_not_found" };
  const supabase = await getServerSupabase();
  try {
    await verifyPendingMedia(supabase, "marketplace", objectKey);
  } catch {
    return { ok: false, code: "image_content_invalid" };
  }
  const { data, error } = await supabase.rpc("marketplace_checkout_receipt_confirm", { p_proof_id: proofId });
  if (error || !data) return { ok: false, ...fail(error) };
  return { ok: true, receiptOk: (data as { receipt_ok?: boolean }).receipt_ok === true };
}

export async function removeReceiptAction(proofId: string): Promise<CheckoutResult<{ removed: true }>> {
  if (!UUID.test(proofId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("marketplace_checkout_receipt_remove", { p_proof_id: proofId });
  if (error) return { ok: false, ...fail(error) };
  return { ok: true, removed: true };
}
