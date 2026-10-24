import type { MediaVariant } from "@/lib/media/image-variants";

/** Same bound as sharp's `limitInputPixels` on Node: decoding more is refused, never attempted. */
export const IMAGE_PIXEL_LIMIT = 25_000_000;
/** A variant over this size steps its quality down; grids should never pull more. */
export const VARIANT_MAX_BYTES = 600 * 1024;
export const VARIANT_QUALITY_STEPS = [80, 72, 64, 56] as const;
export const VERIFIABLE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImageVariant = {
  variant: MediaVariant;
  width: number;
  height: number;
  size: number;
  sha256: string;
  contentType: "image/webp";
  bytes: Uint8Array;
};

/**
 * The one seam between media storage and an image engine. Node (Vercel, the
 * rollback path) uses sharp; the Cloudflare Workers build uses the Images
 * binding (sharp is native and cannot load in workerd). Selected at BUILD time
 * by `runtime.ts` / `runtime.workers.ts`, so neither bundle carries the other.
 */
export interface ImageProcessor {
  readonly name: "sharp" | "cloudflare-images";
  /**
   * Refuses anything that is not ONE complete, decodable, single-frame image of
   * exactly `contentType` within IMAGE_PIXEL_LIMIT. A truncated file must fail.
   */
  verify(bytes: Uint8Array, contentType: string): Promise<void>;
  /** thumb / card / full WebP of VERIFIED bytes: EXIF orientation applied, no metadata, never upscaled. */
  variants(verifiedBytes: Uint8Array): Promise<ImageVariant[]>;
}
