/**
 * Magic-byte check for product images.
 *
 * Storage enforces `allowed_mime_types` from the Content-Type HEADER the browser
 * sends, which a client controls; the database cannot read file bytes at all. So
 * the server looks at the first bytes of the stored object before it confirms an
 * upload, and withdraws a file whose content is not the image type it claims.
 *
 * This is a gate on the normal path, not a guarantee: a caller can still call the
 * confirm RPC directly (the content stays `pending`, never public), so the content
 * review that must precede `media_verification_ready` has to re-validate and decode
 * every image itself. A signature match proves a plausible header, not a safe image.
 */
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/** Bytes needed to decide (RIFF header + WEBP tag). */
export const IMAGE_SIGNATURE_BYTES = 12;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

export function detectImageType(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}

/** True only when the content is an image of exactly the declared type. */
export function matchesDeclaredType(bytes: Uint8Array, declared: string | null | undefined): boolean {
  return declared != null && detectImageType(bytes) === declared;
}
