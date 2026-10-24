/** The private bucket product images are uploaded to (Migration 06). */
export const MARKETPLACE_IMAGE_BUCKET = "marketplace-product-images";

export type SellerActionError = { code: string; detail?: string };

/**
 * The seller RPCs refuse with `mp:<code>[:detail]` (e.g. `mp:sku_taken:WP-001`).
 * Anything else — a network failure, an unexpected database error — becomes
 * `unexpected`, so no raw database text ever reaches the screen.
 */
export function parseSellerError(message: string | null | undefined): SellerActionError {
  const m = /^mp:([a-z_]+)(?::(.*))?$/.exec((message ?? "").trim());
  if (!m || !m[1]) return { code: "unexpected" };
  return m[2] ? { code: m[1], detail: m[2] } : { code: m[1] };
}

/** The message-catalogue key for an error code (falls back to `unexpected`). */
export const KNOWN_ERROR_CODES = new Set([
  "auth_required",
  "not_permitted",
  "seller_not_enabled",
  "not_found",
  "archived",
  "product_type_invalid",
  "product_type_immutable",
  "name_ar_invalid",
  "name_en_invalid",
  "description_too_long",
  "brand_too_long",
  "external_ref_too_long",
  "slug_invalid",
  "slug_taken",
  "external_ref_taken",
  "variants_invalid",
  "duplicate_sku_in_form",
  "sku_invalid",
  "sku_taken",
  "selling_unit_invalid",
  "price_invalid",
  "variant_status_invalid",
  "variant_not_found",
  "attribute_unknown",
  "attribute_invalid",
  "duplicate_variant_combination",
  "location_invalid",
  "location_inactive",
  "delta_invalid",
  "insufficient_stock",
  "stock_changed",
  "image_type_invalid",
  "too_many_images",
  "too_many_pending_uploads",
  "upload_rate_limited",
  "image_content_invalid",
  "image_removed",
  "delete_incomplete",
  "object_still_present",
  "image_not_marked_for_removal",
  "upload_not_found",
  "images_invalid",
  "image_not_found",
  "one_primary_image",
  "upload_failed",
  "file_too_large",
  "delivery_invalid",
  "delivery_too_many",
  "delivery_fee_invalid",
  "delivery_location_invalid",
  "delivery_duplicate",
  "delivery_area_unknown",
  "pickup_invalid",
]);

export function errorKey(code: string): string {
  return `marketplaceSeller.error.${KNOWN_ERROR_CODES.has(code) ? code : "unexpected"}`;
}

/**
 * A publication blocker code from the database (`missing_product_attribute:color`,
 * `missing_variant_attribute:SKU:color`, `no_available_stock`, …) split into the
 * catalogue key and the detail to show beside it.
 */
export function blockerParts(code: string): { key: string; detail?: string } {
  const [head, ...rest] = code.split(":");
  return { key: `marketplaceSeller.blocker.${head}`, detail: rest.length ? rest.join(" · ") : undefined };
}
