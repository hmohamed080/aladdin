/**
 * The product-image storage contract, following `avatar-assets.ts`: a fast,
 * honest answer for the browser before anything uploads. It is NOT the authority —
 * the private `product-images` bucket's own `allowed_mime_types` / `file_size_limit`,
 * the `product_images` metadata-row ownership model, and the three-image trigger
 * (20261015090004_own_products_taxonomy_images.sql) are what actually decide.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client.
 */

export const PRODUCT_IMAGE_BUCKET = "product-images";
/**
 * Mirrors the bucket's `file_size_limit`. It is the ceiling of the PREPARED upload
 * (`resizeImageForUpload` fits every photo under it), not of the photo a person picks.
 */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_COUNT = 3;
export const PRODUCT_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProductImageContentType = (typeof PRODUCT_IMAGE_ALLOWED_TYPES)[number];

/** `<organization>/<product>/<image>.<ext>`, all three UUIDs — what the RPC mints. */
const KEY_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isProductImageKey(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}

export function isProductImageContentType(type: string): type is ProductImageContentType {
  return (PRODUCT_IMAGE_ALLOWED_TYPES as readonly string[]).includes(type);
}

export type ProductImageErrorCode =
  | "showroomProducts.images.errorType"
  | "showroomProducts.images.errorSize"
  | "showroomProducts.images.errorPrepare"
  | "showroomProducts.images.errorUpload";

export type ProductImageValidation = { ok: true } | { ok: false; code: ProductImageErrorCode };

/**
 * Type of a chosen file, and that it is not empty, checked the instant it is picked.
 * Its size is never a reason to refuse it: the upload path prepares a derivative
 * within PRODUCT_IMAGE_MAX_BYTES, and the server re-checks that derivative.
 */
export function validateProductImageFile(file: { type: string; size: number }): ProductImageValidation {
  if (!isProductImageContentType(file.type)) return { ok: false, code: "showroomProducts.images.errorType" };
  if (file.size <= 0) return { ok: false, code: "showroomProducts.images.errorSize" };
  return { ok: true };
}

/** How many more photos fit, given the live count (never negative). */
export function remainingImageSlots(liveCount: number): number {
  return Math.max(0, PRODUCT_IMAGE_MAX_COUNT - liveCount);
}

/** New order after moving the image at `index` one step (`-1` earlier, `1` later); unchanged at the ends. */
export function moveImage<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
