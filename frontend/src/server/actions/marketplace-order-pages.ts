"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import { isMarketplaceProofKey, MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, verifyPendingMedia } from "@/server/storage/media";
import { imageMaxBytes } from "@/server/media/limits";
import { isMarketplaceOrderingEnabled } from "@/lib/env";
import type { OrderDocumentV2, ReasonAction, ReasonPreset } from "@/features/marketplace-orders/order-types";
import { isValidCarrier, isValidTracking, SELLER_ORDER_ACTIONS, type SellerActionPayload, type SellerOrderActionName } from "@/features/marketplace-orders/order-model";

/**
 * Writers of the buyer and seller order pages (PR 13). They are thin wrappers over the state-changing RPCs
 * that PR 12 owns (`marketplace_seller_order_action`, `marketplace_buyer_order_cancel_v2`, the receipt
 * re-upload pair, `marketplace_order_reason_presets`) and PR 13's own `marketplace_seller_order_shipment_update`.
 * The database decides who may do what; these only shape input and turn a refusal into a stable code.
 */
export type OrderPageResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: { message?: string } | null): SellerActionError => parseSellerError(error?.message);

/** PR 12's functions are not in the generated database types of this branch yet; their argument shapes are fixed by the order-model contract. */
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };
const rpcOf = (supabase: Awaited<ReturnType<typeof getServerSupabase>>) => supabase as unknown as RpcClient;

const SELLER_ORDERS = "/showroom/marketplace/orders";
const BUYER_ORDERS = "/market/orders";

function cleanPayload(action: SellerOrderActionName, p: SellerActionPayload): Record<string, unknown> | null {
  const text = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);
  switch (action) {
    case "cancel":
    case "flag_receipt_not_received": {
      if (p.preset_id) return UUID.test(p.preset_id) ? { preset_id: p.preset_id, ...(action === "cancel" && p.internal_note ? { internal_note: text(p.internal_note, 300) } : {}) } : null;
      const ar = text(p.message_ar, 300);
      const en = text(p.message_en, 300);
      if (!ar || !en) return null;
      return { message_ar: ar, message_en: en, ...(action === "cancel" && p.internal_note ? { internal_note: text(p.internal_note, 300) } : {}) };
    }
    case "mark_shipped": {
      const out: Record<string, unknown> = {};
      if (p.carrier_name?.trim()) {
        if (!isValidCarrier(p.carrier_name)) return null;
        out.carrier_name = text(p.carrier_name, 80);
      }
      if (p.tracking_number?.trim()) {
        if (!isValidTracking(p.tracking_number)) return null;
        out.tracking_number = text(p.tracking_number, 64);
      }
      return out;
    }
    case "accept_receipt":
      return p.proof_id && UUID.test(p.proof_id) ? { proof_id: p.proof_id } : {};
    case "mark_delivery_failed":
      return p.note ? { note: text(p.note, 300) } : {};
    default:
      return {};
  }
}

export async function sellerOrderActionPageAction(
  orderId: string,
  action: SellerOrderActionName,
  payload: SellerActionPayload,
): Promise<OrderPageResult<{ order: OrderDocumentV2 }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!(SELLER_ORDER_ACTIONS as readonly string[]).includes(action)) return { ok: false, code: "invalid_action" };
  const clean = cleanPayload(action, payload ?? {});
  if (!clean) return { ok: false, code: action === "mark_shipped" ? "tracking_invalid" : "reason_required" };
  const { data, error } = await rpcOf(await getServerSupabase()).rpc("marketplace_seller_order_action", {
    p_order_id: orderId,
    p_action: action,
    p_payload: clean,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_ORDERS);
  return { ok: true, order: data as OrderDocumentV2 };
}

export async function shipmentUpdateAction(orderId: string, carrier: string, tracking: string): Promise<OrderPageResult<{ order: OrderDocumentV2 }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (carrier.trim() && !isValidCarrier(carrier)) return { ok: false, code: "carrier_invalid" };
  if (tracking.trim() && !isValidTracking(tracking)) return { ok: false, code: "tracking_invalid" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_order_shipment_update", {
    p_order_id: orderId,
    p_carrier_name: carrier.trim() || undefined,
    p_tracking_number: tracking.trim() || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_ORDERS);
  return { ok: true, order: data as unknown as OrderDocumentV2 };
}

export async function reasonPresetsAction(action: ReasonAction): Promise<OrderPageResult<{ presets: ReasonPreset[] }>> {
  if (!["order_cancel_seller", "order_cancel_buyer", "payment_issue"].includes(action)) return { ok: false, code: "invalid_action" };
  const { data, error } = await rpcOf(await getServerSupabase()).rpc("marketplace_order_reason_presets", { p_action: action });
  if (error || !Array.isArray(data)) return { ok: false, ...fail(error) };
  return { ok: true, presets: data as ReasonPreset[] };
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------
export async function buyerCancelOrderPageAction(orderId: string, presetId: string | null, note: string): Promise<OrderPageResult<{ order: OrderDocumentV2 }>> {
  if (!isMarketplaceOrderingEnabled()) return { ok: false, code: "not_found" };
  if (!UUID.test(orderId) || (presetId !== null && !UUID.test(presetId))) return { ok: false, code: "not_found" };
  const { data, error } = await rpcOf(await getServerSupabase()).rpc("marketplace_buyer_order_cancel_v2", {
    p_order_id: orderId,
    p_preset_id: presetId,
    p_note: note.trim().slice(0, 300) || null,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_ORDERS);
  return { ok: true, order: data as OrderDocumentV2 };
}

/** Upload ticket for the replacement receipt after «لم تصلني الفلوس» (the first receipt is uploaded at checkout). */
export async function requestResubmitUploadAction(
  orderId: string,
  contentType: string,
  expectedBytes: number,
): Promise<OrderPageResult<{ proofId: string; objectKey: string; grant: UploadGrant }>> {
  if (!isMarketplaceOrderingEnabled()) return { ok: false, code: "not_found" };
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(contentType)) return { ok: false, code: "image_type_invalid" };
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > (await imageMaxBytes("marketplace"))) {
    return { ok: false, code: "file_too_large" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await rpcOf(supabase).rpc("marketplace_buyer_receipt_resubmit_request_upload", {
    p_order_id: orderId,
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

export async function confirmResubmitAction(proofId: string, objectKey: string): Promise<OrderPageResult<{ order: OrderDocumentV2 }>> {
  if (!isMarketplaceOrderingEnabled()) return { ok: false, code: "not_found" };
  if (!UUID.test(proofId) || !isMarketplaceProofKey(objectKey) || !objectKey.includes(`/${proofId}.`)) return { ok: false, code: "upload_not_found" };
  const supabase = await getServerSupabase();
  try {
    await verifyPendingMedia(supabase, "marketplace", objectKey);
  } catch {
    return { ok: false, code: "image_content_invalid" };
  }
  const { data, error } = await rpcOf(supabase).rpc("marketplace_buyer_receipt_resubmit_confirm", { p_proof_id: proofId });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_ORDERS);
  return { ok: true, order: data as OrderDocumentV2 };
}
