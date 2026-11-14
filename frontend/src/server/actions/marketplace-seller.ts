"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError, type SellerActionError } from "@/features/marketplace-seller/errors";
import { removeImageLifecycle, type RemovalResult } from "@/features/marketplace-seller/image-removal";
import { isMarketplaceImageKey, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, removeMedia, resolveMedia, verifyPendingMedia } from "@/server/storage/media";
import type { Json } from "@/types/database.types";

/**
 * Marketplace seller writers. Thin wrappers over the trusted SECURITY DEFINER
 * RPCs (Migration 06): authentication, organization membership, catalogue
 * authority, seller approval, ownership, validation, atomicity and the stock
 * ledger all live in the database. These actions run under the caller's OWN
 * session — no service credential is involved — and only translate a refusal
 * into a stable code the form can show.
 */
export type SellerResult<T> = ({ ok: true } & T) | ({ ok: false } & SellerActionError);

const PRODUCTS_PATH = "/showroom/marketplace/products";

export type SavedProduct = {
  id: string;
  created: boolean;
  status: string;
  blockers: string[];
  variants: { id: string; sku: string; status: string }[];
};

function fail(error: { message?: string } | null): SellerActionError {
  return parseSellerError(error?.message);
}

export async function saveSellerProductAction(
  payload: Record<string, unknown>,
): Promise<SellerResult<SavedProduct>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_product_save", { p_payload: payload as Json });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as SavedProduct;
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, ...r };
}

export async function productReadinessAction(productId: string): Promise<SellerResult<{ blockers: string[] }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_product_readiness", { p_product_id: productId });
  if (error) return { ok: false, ...fail(error) };
  return { ok: true, blockers: (data ?? []) as string[] };
}

export async function publishProductAction(productId: string): Promise<SellerResult<{ status: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_product_publish", { p_product_id: productId });
  if (error) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  revalidatePath("/marketplace");
  return { ok: true, status: String(data) };
}

/** Takes a published product off the public Marketplace (back to "unpublished"; never archives). */
export async function unpublishProductAction(productId: string): Promise<SellerResult<{ status: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_product_unpublish", { p_product_id: productId, p_archive: false });
  if (error) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  revalidatePath("/marketplace");
  return { ok: true, status: String(data) };
}

export async function ensureDefaultLocationAction(organizationId: string): Promise<SellerResult<{ locationId: string }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_default_location", { p_organization_id: organizationId });
  if (error || !data) return { ok: false, ...fail(error) };
  return { ok: true, locationId: data as string };
}

/**
 * One stock change through the ledger. `key` makes a repeated click a no-op;
 * `expectedOnHand`, when given, refuses the change if the stock moved since the
 * screen was drawn. The returned numbers are the SERVER's — the UI shows only these.
 */
export async function adjustStockAction(input: {
  variantId: string;
  locationId: string;
  delta: number;
  key: string;
  expectedOnHand?: number | null;
}): Promise<SellerResult<{ applied: boolean; onHand: number; reserved: number; available: number }>> {
  if (!Number.isInteger(input.delta) || input.delta === 0) return { ok: false, code: "delta_invalid" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_stock_adjust", {
    p_variant_id: input.variantId,
    p_location_id: input.locationId,
    p_delta: input.delta,
    p_idempotency_key: input.key,
    p_expected_on_hand: input.expectedOnHand ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { applied: boolean; on_hand: number; reserved: number; available: number };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, applied: r.applied, onHand: r.on_hand, reserved: r.reserved, available: r.available };
}

/**
 * Upload ticket: the database issues the pending row and key, then the central media
 * layer (`authorizeMediaUpload`) re-authorizes the caller, reserves the key on R2 and
 * returns the upload grant. Bytes never pass through a Supabase Storage bucket.
 */
export async function requestImageUploadAction(
  productId: string,
  contentType: string,
  expectedBytes: number,
  variantId?: string | null,
): Promise<SellerResult<{ imageId: string; objectKey: string; grant: UploadGrant }>> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MARKETPLACE_IMAGE_MAX_BYTES) {
    return { ok: false, code: "file_too_large" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_image_request_upload", {
    p_product_id: productId,
    p_content_type: contentType,
    p_variant_id: variantId ?? undefined,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  const r = data as { image_id: string; object_key: string };
  if (!isMarketplaceImageKey(r.object_key)) return { ok: false, code: "unexpected" };
  try {
    return { ok: true, imageId: r.image_id, objectKey: r.object_key,
      grant: await authorizeMediaUpload(supabase, "marketplace", r.object_key, expectedBytes) };
  } catch {
    await runImageRemoval(supabase, r.image_id);
    return { ok: false, code: "upload_failed" };
  }
}

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** Phase 1 -> 2 -> 3 of the image removal (Migration 07), on the central media system. */
async function runImageRemoval(supabase: Supabase, imageId: string): Promise<RemovalResult> {
  return removeImageLifecycle(
    {
      async mark(id) {
        const { data, error } = await supabase.rpc("marketplace_seller_image_remove", { p_image_id: id });
        if (error) return { error: parseSellerError(error.message).code };
        return { key: String(data) };
      },
      async deleteObject(key) {
        try {
          // A key that was issued but never reserved has no bytes anywhere: nothing to delete.
          if (!(await resolveMedia(supabase, "marketplace", key, "delete")).reserved) return {};
          // Deletes the original and its variants and records cleaned_at, which finalize checks.
          await removeMedia(supabase, "marketplace", key);
          return {};
        } catch (error) {
          return { error: error instanceof Error ? error.message : "delete failed" };
        }
      },
      async finalize(id) {
        const { error } = await supabase.rpc("marketplace_seller_image_remove_finalize", { p_image_id: id });
        return error ? { error: parseSellerError(error.message).code } : { ok: true as const };
      },
    },
    imageId,
  );
}

/**
 * Confirmed only after the central verifier (`verifyPendingMedia`) read the stored bytes,
 * checked the signature against the declared type, fully decoded them with the runtime image
 * engine and recorded the size + sha256 receipt; the database refuses the confirm without that
 * receipt. Bytes that fail are withdrawn through the removal lifecycle and refused. Content
 * stays `pending` until a moderator approves it.
 */
export async function confirmImageUploadAction(imageId: string): Promise<SellerResult<{ isPrimary: boolean }>> {
  const supabase = await getServerSupabase();

  const { data: row } = await supabase
    .from("marketplace_product_images")
    .select("object_key, upload_state")
    .eq("id", imageId)
    .maybeSingle();
  if (row && row.upload_state === "awaiting_upload") {
    if (!isMarketplaceImageKey(row.object_key)) return { ok: false, code: "unexpected" };
    try {
      await verifyPendingMedia(supabase, "marketplace", row.object_key);
    } catch {
      await runImageRemoval(supabase, imageId);
      revalidatePath(PRODUCTS_PATH);
      return { ok: false, code: "image_content_invalid" };
    }
  }

  const { data, error } = await supabase.rpc("marketplace_seller_image_confirm_upload", { p_image_id: imageId });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true, isPrimary: Boolean((data as { is_primary?: boolean }).is_primary) };
}

export async function updateImagesAction(
  productId: string,
  images: { id: string; sort_order: number; is_primary: boolean; variant_id: string | null }[],
): Promise<SellerResult<object>> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("marketplace_seller_images_update", {
    p_product_id: productId,
    p_images: images as unknown as Json,
  });
  if (error) return { ok: false, ...fail(error) };
  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

/**
 * Removes an image: mark -> delete the bytes -> finalize (see `image-removal.ts`).
 * Success is reported only once the database has confirmed the object is gone; a
 * failure leaves the image withdrawn (invisible to everyone) and retryable.
 */
export async function removeImageAction(imageId: string): Promise<SellerResult<{ alreadyRemoved: boolean }>> {
  const supabase = await getServerSupabase();
  const r = await runImageRemoval(supabase, imageId);
  revalidatePath(PRODUCTS_PATH);
  if (!r.ok) return { ok: false, code: r.code };
  return { ok: true, alreadyRemoved: r.alreadyRemoved };
}

/** Retries every removal of a product that was marked but not finished. */
export async function finishPendingImageRemovalsAction(productId: string): Promise<SellerResult<{ finished: number; failed: number }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_images_pending_removal", { p_product_id: productId });
  if (error) return { ok: false, ...fail(error) };
  let finished = 0;
  let failed = 0;
  for (const item of (data ?? []) as { image_id: string }[]) {
    const r = await runImageRemoval(supabase, item.image_id);
    if (r.ok) finished += 1;
    else failed += 1;
  }
  revalidatePath(PRODUCTS_PATH);
  return failed > 0 ? { ok: false, code: "delete_incomplete" } : { ok: true, finished, failed };
}

/* ---------- delivery areas, delivery prices and pickup (Migration 12) ---------- */

const AREAS_PATH = "/showroom/marketplace/areas";
const DELIVERY_PATH = "/showroom/marketplace/delivery";

/** A place a showroom delivers to: a governorate (`area_key` null) or one area inside it. */
export type DeliveryPlace = { governorate_key: string; area_key: string | null };
/** A place with its price; `fee_egp` null = covered but not priced yet. */
export type DeliveryRate = DeliveryPlace & { fee_egp: number | null };

/**
 * Sets WHERE the showroom delivers (replaces the set of places; the price of a place that stays is kept,
 * a new place starts unpriced, a place left out is removed). An empty list = delivers nowhere.
 */
export async function saveSellerAreasAction(
  organizationId: string,
  places: DeliveryPlace[],
): Promise<SellerResult<{ saved: number }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_delivery_areas_save", {
    p_organization_id: organizationId,
    p_areas: places as unknown as Json,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(AREAS_PATH);
  revalidatePath(DELIVERY_PATH);
  return { ok: true, saved: Number((data as { saved?: number }).saved ?? places.length) };
}

/** Sets WHAT the showroom charges for places it already covers (null clears a price). */
export async function saveSellerPricesAction(
  organizationId: string,
  prices: DeliveryRate[],
): Promise<SellerResult<{ saved: number }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_delivery_prices_save", {
    p_organization_id: organizationId,
    p_prices: prices as unknown as Json,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(AREAS_PATH);
  revalidatePath(DELIVERY_PATH);
  return { ok: true, saved: Number((data as { saved?: number }).saved ?? prices.length) };
}

/** Turns "pick up from the showroom" on or off for buyers' carts. */
export async function setSellerPickupAction(
  organizationId: string,
  enabled: boolean,
): Promise<SellerResult<{ pickupAvailable: boolean }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_seller_pickup_set", {
    p_organization_id: organizationId,
    p_enabled: enabled,
  });
  if (error || !data) return { ok: false, ...fail(error) };
  revalidatePath(DELIVERY_PATH);
  return { ok: true, pickupAvailable: Boolean((data as { pickup_available?: boolean }).pickup_available) };
}
