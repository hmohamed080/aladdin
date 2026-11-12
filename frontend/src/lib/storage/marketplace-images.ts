/**
 * The Marketplace product-image contract (ADR-0028), following `product-images.ts`: a fast,
 * honest answer before anything uploads. It is NOT the authority — the `marketplace` media
 * namespace (20261112100013_marketplace_media.sql) and its receipt/resolver functions decide.
 * Photos are R2-only: there is no Supabase Storage bucket; `MARKETPLACE_IMAGE_BUCKET` is the
 * logical namespace name the image rows record.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client.
 */
export const MARKETPLACE_IMAGE_BUCKET = "marketplace";
export const MARKETPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MARKETPLACE_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** `<organization>/<product>/<image>.<ext>`, all three UUIDs — what the request-upload RPC mints. */
const KEY_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isMarketplaceImageKey(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}
