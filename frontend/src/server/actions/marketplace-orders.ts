"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import {
  SELLER_ACTIONS,
  type OrderDocument,
  type PaymentSettings,
  type PlacedCheckout,
  type SellerAction,
} from "@/features/marketplace-orders/contract";
import { isMarketplaceProofKey, MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, verifyPendingMedia } from "@/server/storage/media";
import { readableMediaUrl } from "@/server/storage/edge-ticket";
import type { Json } from "@/types/database.types";

/**
 * Marketplace checkout and order writers (Migration 14). Thin wrappers over the SECURITY DEFINER
 * RPCs, run under the caller's OWN session: who may place, cancel, confirm, ship or review is
 * decided in the database, which also reserves, releases and deducts stock. These actions only
 * shape input and turn a refusal into a stable code.
 */
export type OrderResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const fail = (error: { message?: string } | null): SellerActionError => parseSellerError(error?.message);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SELLER_ORDERS = "/showroom/marketplace/orders";
const BUYER_ORDERS = "/marketplace/orders";

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
export type CheckoutLine = { slug: string; sku: string; qty: number };
export type CheckoutContact = { name: string; phone: string; note: string; governorate: string; area: string; address: string };
export type CheckoutSellerChoice = { index: number; fulfilment: "delivery" | "pickup"; payment: "cod" | "instapay" };

export async function placeCheckoutAction(
  lines: CheckoutLine[],
  contact: CheckoutContact,
  sellers: CheckoutSellerChoice[],
  idempotencyKey: string,
): Promise<OrderResult<{ checkout: PlacedCheckout }>> {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) return { ok: false, code: "invalid_lines" };
  if (!Array.isArray(sellers) || typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
    return { ok: false, code: "invalid_payload" };
  }
  const cleanLines = lines.map((l) => ({ slug: String(l.slug), sku: String(l.sku), qty: Math.round(Number(l.qty)) }));
  const cleanSellers = sellers.map((s) => ({ index: Number(s.index), fulfilment: s.fulfilment, payment: s.payment }));
  const cleanContact = {
    name: String(contact?.name ?? "").slice(0, 100),
    phone: String(contact?.phone ?? "").slice(0, 30),
    note: String(contact?.note ?? "").slice(0, 500),
    governorate: String(contact?.governorate ?? "").slice(0, 40),
    area: String(contact?.area ?? "").slice(0, 40),
    address: String(contact?.address ?? "").slice(0, 300),
  };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_checkout_place", {
    p_lines: cleanLines as unknown as Json,
    p_contact: cleanContact as unknown as Json,
    p_sellers: cleanSellers as unknown as Json,
    p_idempotency_key: idempotencyKey,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_ORDERS);
  return { ok: true, checkout: data as unknown as PlacedCheckout };
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------
export async function cancelBuyerOrderAction(orderId: string, reason: string): Promise<OrderResult<{ order: OrderDocument }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_order_cancel", {
    p_order_id: orderId,
    p_reason: reason.trim().slice(0, 300) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_ORDERS);
  return { ok: true, order: data as unknown as OrderDocument };
}

/** Receipt upload ticket: the database mints the key, the central media layer reserves it and grants the upload. */
export async function requestProofUploadAction(
  orderId: string,
  contentType: string,
  expectedBytes: number,
): Promise<OrderResult<{ proofId: string; objectKey: string; grant: UploadGrant }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(contentType)) return { ok: false, code: "image_type_invalid" };
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MARKETPLACE_IMAGE_MAX_BYTES) {
    return { ok: false, code: "file_too_large" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_proof_request_upload", {
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

/**
 * Verifies the stored bytes (central verifier: signature, full decode, size + sha256 receipt), then
 * tells the showroom a receipt is waiting. The key is the one the upload ticket returned; the media
 * resolver only lets the order's buyer verify it, and the confirm RPC refuses a key that is not the
 * proof's own or has no receipt.
 */
export async function confirmProofAction(proofId: string, objectKey: string): Promise<OrderResult<{ order: OrderDocument }>> {
  if (!UUID.test(proofId) || !isMarketplaceProofKey(objectKey) || !objectKey.includes(`/${proofId}.`)) return { ok: false, code: "upload_not_found" };
  const supabase = await getServerSupabase();
  try {
    await verifyPendingMedia(supabase, "marketplace", objectKey);
  } catch {
    return { ok: false, code: "image_content_invalid" };
  }
  const { data, error } = await supabase.rpc("marketplace_buyer_proof_confirm", { p_proof_id: proofId });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(BUYER_ORDERS);
  return { ok: true, order: data as unknown as OrderDocument };
}

/**
 * A short-lived URL of one receipt for whoever may read it (the buyer, or the showroom's order
 * managers): the media resolver re-checks that on every call.
 */
export async function proofImageUrlAction(objectKey: string): Promise<OrderResult<{ url: string }>> {
  if (!isMarketplaceProofKey(objectKey)) return { ok: false, code: "not_found" };
  try {
    return { ok: true, url: await readableMediaUrl(await getServerSupabase(), "marketplace", objectKey) };
  } catch {
    return { ok: false, code: "not_found" };
  }
}

// ---------------------------------------------------------------------------
// Showroom
// ---------------------------------------------------------------------------
export async function savePaymentSettingsAction(
  organizationId: string,
  settings: Omit<PaymentSettings, "can_edit">,
): Promise<OrderResult<{ settings: PaymentSettings }>> {
  if (!UUID.test(organizationId)) return { ok: false, code: "not_permitted" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_payment_settings_save", {
    p_organization_id: organizationId,
    p_settings: {
      cod_enabled: Boolean(settings.cod_enabled),
      instapay_enabled: Boolean(settings.instapay_enabled),
      instapay_address: settings.instapay_address?.trim() || null,
      instapay_account_name: settings.instapay_account_name?.trim() || null,
      instapay_deposit_percent: settings.instapay_deposit_percent === null ? null : String(settings.instapay_deposit_percent),
    } as unknown as Json,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath("/showroom/marketplace/payments");
  return { ok: true, settings: data as unknown as PaymentSettings };
}

export async function sellerOrderTransitionAction(
  orderId: string,
  action: SellerAction,
  note: string,
): Promise<OrderResult<{ order: OrderDocument }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!(SELLER_ACTIONS as readonly string[]).includes(action)) return { ok: false, code: "invalid_transition" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_order_transition", {
    p_order_id: orderId,
    p_action: action,
    p_note: note.trim().slice(0, 300) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_ORDERS);
  return { ok: true, order: data as unknown as OrderDocument };
}

export async function reviewProofAction(proofId: string, accept: boolean, note: string): Promise<OrderResult<{ order: OrderDocument }>> {
  if (!UUID.test(proofId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_proof_review", {
    p_proof_id: proofId,
    p_accept: accept,
    p_note: note.trim().slice(0, 300) || undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(SELLER_ORDERS);
  return { ok: true, order: data as unknown as OrderDocument };
}
