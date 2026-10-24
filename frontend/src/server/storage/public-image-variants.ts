import "server-only";
import type { MediaVariant } from "@/lib/media/image-variants";
import { runtimeImageProcessor } from "./image-processing/runtime";
import type { ImageVariant } from "./image-processing/types";
import { verifyMediaBytes, withMediaProcessingSlot } from "./validation";

export { VARIANT_MAX_BYTES } from "./image-processing/types";
export type { ImageVariant } from "./image-processing/types";

/** What a receipt can record per variant (WP1 `media_storage_locations.variants`). No bytes, no keys. */
export type VariantManifest = Partial<Record<MediaVariant, { width: number; height: number; size: number; sha256: string }>>;

export function variantManifest(variants: readonly ImageVariant[]): VariantManifest {
  return Object.fromEntries(variants.map(({ variant, width, height, size, sha256 }) => [variant, { width, height, size, sha256 }]));
}

/**
 * thumb / card / full WebP derivatives of ALREADY-VERIFIED image bytes, by this
 * runtime's image engine (image-processing/). EXIF orientation is baked in, no
 * metadata is written (no EXIF, GPS or XMP), and nothing is upscaled: a small
 * original yields variants at its own size, so every verified image has the same
 * three keys. Bounded by the same per-instance slot as verification.
 */
export async function generateImageVariants(verifiedBytes: Uint8Array): Promise<ImageVariant[]> {
  return withMediaProcessingSlot(() => runtimeImageProcessor().variants(verifiedBytes));
}

/** For explicitly public pipelines that receive unverified bytes: verify first, then derive. */
export async function generatePublicImageVariants(bytes: Uint8Array, contentType: string, maxBytes: number) {
  await verifyMediaBytes(bytes, contentType, maxBytes);
  if (!contentType.startsWith("image/")) throw new Error("image required");
  return generateImageVariants(bytes);
}
