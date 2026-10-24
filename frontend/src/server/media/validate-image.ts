import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

export type ImageValidation =
  | { valid: true; format: "jpeg" | "png" | "webp"; width: number; height: number; byteSize: number; sha256: string }
  | { valid: false; reason: string; byteSize: number; sha256: string };

/** The largest image the Marketplace accepts, per side. */
const MAX_SIDE = 12000;

/** File signature (magic bytes) → format. The declared Content-Type is never trusted. */
function signature(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Trusted, byte-level validation of one product image:
 *   1. the file SIGNATURE must be JPEG / PNG / WebP;
 *   2. the decoder must agree on that format;
 *   3. the WHOLE image must decode without error (truncated or corrupt files fail
 *      here, not on a customer's screen);
 *   4. both sides between 1 and 12000 px.
 * Returns the facts the database records next to the moderation decision.
 */
export async function validateImageBytes(input: ArrayBuffer | Buffer): Promise<ImageValidation> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const byteSize = buf.length;
  const sig = signature(buf);
  if (!sig) return { valid: false, reason: "unknown_signature", byteSize, sha256 };
  try {
    const meta = await sharp(buf, { failOn: "error" }).metadata();
    if (meta.format !== sig) return { valid: false, reason: "format_mismatch", byteSize, sha256 };
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
      return { valid: false, reason: "dimensions_out_of_range", byteSize, sha256 };
    }
    // Full decode: proves every pixel can be read.
    await sharp(buf, { failOn: "error" }).raw().toBuffer();
    return { valid: true, format: sig, width, height, byteSize, sha256 };
  } catch {
    return { valid: false, reason: "decode_failed", byteSize, sha256 };
  }
}
