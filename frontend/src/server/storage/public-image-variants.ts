import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { MEDIA_VARIANTS, MEDIA_VARIANT_WIDTH, type MediaVariant } from "@/lib/media/image-variants";
import { verifyMediaBytes, withMediaProcessingSlot } from "./validation";

/** A variant over this size steps its quality down; grids should never pull more. */
export const VARIANT_MAX_BYTES = 600 * 1024;
const QUALITY_STEPS = [80, 72, 64, 56] as const;

export type ImageVariant = {
  variant: MediaVariant;
  width: number;
  height: number;
  size: number;
  sha256: string;
  contentType: "image/webp";
  bytes: Uint8Array;
};

/** What a receipt can record per variant (WP1 `media_storage_locations.variants`). No bytes, no keys. */
export type VariantManifest = Partial<Record<MediaVariant, { width: number; height: number; size: number; sha256: string }>>;

export function variantManifest(variants: readonly ImageVariant[]): VariantManifest {
  return Object.fromEntries(variants.map(({ variant, width, height, size, sha256 }) => [variant, { width, height, size, sha256 }]));
}

/**
 * thumb / card / full WebP derivatives of ALREADY-VERIFIED image bytes.
 *
 * `rotate()` bakes the EXIF orientation in first; sharp then writes no metadata
 * at all (no EXIF, no GPS, no XMP), so a variant never carries the camera
 * location the original might. Never upscales: a small original yields variants
 * at its own size, so every verified image has the same three keys. Bounded by
 * the same per-instance decode slot and pixel limit as verification, and encoded
 * one at a time so peak memory is one decoded source plus one output.
 */
export async function generateImageVariants(verifiedBytes: Uint8Array): Promise<ImageVariant[]> {
  return withMediaProcessingSlot(async () => {
    const source = sharp(verifiedBytes, { limitInputPixels: 25_000_000, failOn: "warning" }).rotate();
    const variants: ImageVariant[] = [];
    for (const variant of MEDIA_VARIANTS) {
      const resized = source.clone().resize({ width: MEDIA_VARIANT_WIDTH[variant], withoutEnlargement: true });
      let output: { data: Buffer; info: sharp.OutputInfo } | undefined;
      for (const quality of QUALITY_STEPS) {
        output = await resized.clone().webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
        if (output.data.byteLength <= VARIANT_MAX_BYTES) break;
      }
      const { data, info } = output!;
      variants.push({
        variant, width: info.width, height: info.height, size: data.byteLength, contentType: "image/webp",
        sha256: createHash("sha256").update(data).digest("hex"), bytes: new Uint8Array(data),
      });
    }
    return variants;
  });
}

/** For explicitly public pipelines that receive unverified bytes: verify first, then derive. */
export async function generatePublicImageVariants(bytes: Uint8Array, contentType: string, maxBytes: number) {
  await verifyMediaBytes(bytes, contentType, maxBytes);
  if (!contentType.startsWith("image/")) throw new Error("image required");
  return generateImageVariants(bytes);
}
