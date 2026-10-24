import sharp from "sharp";

const TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Node-only image verification (plain JS so `scripts/media-storage.mjs` can use it).
 * metadata() alone accepts truncated images, so this forces a full bounded decode;
 * `failOn: "warning"` turns a corrupt scan into a refusal.
 */
export async function verifyImageWithSharp(bytes, contentType) {
  const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
  const metadata = await image.metadata();
  if (!metadata.format || TYPES[metadata.format] !== contentType || (metadata.pages ?? 1) !== 1) {
    throw new Error("unsupported image");
  }
  await image.raw().toBuffer();
}
