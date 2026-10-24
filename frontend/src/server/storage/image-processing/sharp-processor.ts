import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { MEDIA_VARIANTS, MEDIA_VARIANT_WIDTH } from "@/lib/media/image-variants";
import { verifyImageWithSharp } from "./sharp-verify.mjs";
import { IMAGE_PIXEL_LIMIT, VARIANT_MAX_BYTES, VARIANT_QUALITY_STEPS, type ImageProcessor, type ImageVariant } from "./types";

/**
 * Node implementation. `rotate()` bakes the EXIF orientation in first; sharp then
 * writes no metadata at all (no EXIF, no GPS, no XMP). Encoded one variant at a
 * time so peak memory is one decoded source plus one output.
 */
export const sharpImageProcessor: ImageProcessor = {
  name: "sharp",
  verify: verifyImageWithSharp,
  async variants(verifiedBytes) {
    const source = sharp(verifiedBytes, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "warning" }).rotate();
    const variants: ImageVariant[] = [];
    for (const variant of MEDIA_VARIANTS) {
      const resized = source.clone().resize({ width: MEDIA_VARIANT_WIDTH[variant], withoutEnlargement: true });
      let output: { data: Buffer; info: sharp.OutputInfo } | undefined;
      for (const quality of VARIANT_QUALITY_STEPS) {
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
  },
};
