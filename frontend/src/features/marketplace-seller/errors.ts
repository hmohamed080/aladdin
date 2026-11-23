export type SellerActionError = { code: string; detail?: string };

/**
 * The seller RPCs refuse with `mp:<code>[:detail]` (e.g. `mp:sku_taken:WP-001`).
 * Anything else — a network failure, an unexpected database error — becomes
 * `unexpected`, so no raw database text ever reaches the screen.
 */
export function parseSellerError(message: string | null | undefined): SellerActionError {
  if (/^publication blocked:.*\bseller_no_(payment_method|delivery)\b/.test((message ?? "").trim())) return { code: "store_setup_missing" };
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
  "low_stock_invalid",
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
  "image_not_replaceable",
  "replacement_pending",
  "delete_incomplete",
  "object_still_present",
  "image_not_marked_for_removal",
  "upload_not_found",
  "images_invalid",
  "image_not_found",
  "one_primary_image",
  "upload_failed",
  "file_too_large",
  "video_too_large",
  "file_type_invalid",
  "video_upload_failed",
  "delivery_invalid",
  "delivery_too_many",
  "delivery_fee_invalid",
  "delivery_location_invalid",
  "delivery_duplicate",
  "delivery_area_unknown",
  "pickup_invalid",
  "preparation_days_invalid",
  "free_shipping_invalid",
  "pickup_instructions_invalid",
  "duration_invalid",
  "next_day_invalid",
  "next_day_fee_invalid",
  "search_invalid",
  "store_setup_missing",
]);

export function errorKey(code: string): string {
  return `marketplaceSeller.error.${KNOWN_ERROR_CODES.has(code) ? code : "unexpected"}`;
}
