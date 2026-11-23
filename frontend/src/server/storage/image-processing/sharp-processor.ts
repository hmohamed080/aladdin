import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { MEDIA_VARIANTS, MEDIA_VARIANT_WIDTH } from "@/lib/media/image-variants";
import { ORIGINAL_MAX_EDGE } from "@/lib/media/upload-limits";
import { stripPersonalMetadata } from "./metadata-strip";
import { verifyImageWithSharp } from "./sharp-verify.mjs";
import {
  IMAGE_PIXEL_LIMIT, ORIGINAL_QUALITY_STEPS, VARIANT_MAX_BYTES, VARIANT_QUALITY_STEPS,
  type ImageProcessor, type ImageVariant, type ReencodedOriginal,
} from "./types";

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
  async reencodeOriginal(verifiedBytes, contentType, maxBytes) {
    if (contentType !== "image/jpeg" && contentType !== "image/png" && contentType !== "image/webp") throw new Error("unsupported image");
    // `rotate()` bakes the EXIF orientation in. `withIccProfile("srgb")` converts from the embedded
    // profile (Display P3, Adobe RGB, CMYK ...) to sRGB with a proper transform and attaches the
    // sRGB profile, so the colours are the same on every screen. No `withMetadata`: EXIF, GPS and
    // XMP are not written.
    const prepared = () => sharp(verifiedBytes, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "warning" })
      .rotate()
      .resize({ width: ORIGINAL_MAX_EDGE, height: ORIGINAL_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .withIccProfile("srgb");
    for (const quality of ORIGINAL_QUALITY_STEPS) {
      const image = prepared();
      const encoded = contentType === "image/jpeg" ? image.jpeg({ quality, chromaSubsampling: "4:4:4" })
        : contentType === "image/webp" ? image.webp({ quality, smartSubsample: true, effort: 4 })
        // No `effort`/`quality`/`colours` here: sharp reads any of them as "palette: true" and
        // quantises the image to 256 colours, which would break colour fidelity.
        : image.png({ compressionLevel: 9, palette: false });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      if (data.byteLength > maxBytes) {
        if (contentType === "image/png") break; // lossless: lowering quality changes nothing
        continue;
      }
      return { bytes: stripPersonalMetadata(new Uint8Array(data), contentType), contentType, width: info.width, height: info.height } satisfies ReencodedOriginal;
    }
    throw new Error("image does not fit the size limit once re-encoded");
  },
};
