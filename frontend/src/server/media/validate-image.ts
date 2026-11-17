import "server-only";

import { verifyMediaBytes } from "@/server/storage/validation";

export type ImageValidation =
  | { valid: true; format: "jpeg" | "png" | "webp"; width: number; height: number; byteSize: number; sha256: string }
  | { valid: false; reason: string; byteSize: number; sha256: string };

/** The largest image the Marketplace accepts, per side, and in bytes (Migration 06 bucket limit). */
const MAX_SIDE = 12000;
const MAX_BYTES = 5 * 1024 * 1024;

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** File signature (magic bytes) → format. The declared Content-Type is never trusted. */
function signature(b: Uint8Array): keyof typeof MIME | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return null;
}

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.subarray(from, to));
}

/** Pixel size read from the header. Only called after the engine decoded the whole image. */
function dimensions(b: Uint8Array, format: keyof typeof MIME): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (format === "png") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (format === "webp") {
    const chunk = ascii(b, 12, 16);
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = view.getUint16(24, true) | (view.getUint8(26) << 16);
      const h = view.getUint16(27, true) | (view.getUint8(29) << 16);
      return { width: w + 1, height: h + 1 };
    }
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0..SOF15 except DHT/JPG/DAC).
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = view.getUint8(i + 1);
    const length = view.getUint16(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

async function sha256Hex(b: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(b));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Trusted, byte-level validation of one Marketplace product image:
 *   1. the file SIGNATURE must be JPEG / PNG / WebP;
 *   2. this runtime's image engine (sharp on Node, Cloudflare Images on Workers)
 *      must decode the WHOLE image as that format — truncated or corrupt files
 *      fail here, not on a customer's screen;
 *   3. both sides between 1 and 12000 px.
 * Returns the facts the database records next to the moderation decision.
 */
export async function validateImageBytes(input: ArrayBuffer | Uint8Array): Promise<ImageValidation> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const byteSize = bytes.byteLength;
  const sha256 = await sha256Hex(bytes);
  const format = signature(bytes);
  if (!format) return { valid: false, reason: "unsupported_signature", byteSize, sha256 };
  if (byteSize > MAX_BYTES) return { valid: false, reason: "file_too_large", byteSize, sha256 };
  try {
    await verifyMediaBytes(bytes, MIME[format], MAX_BYTES);
  } catch (error) {
    console.warn(JSON.stringify({ event: "marketplace.image_decode_failed", format, reason: error instanceof Error ? error.message : "unknown" }));
    return { valid: false, reason: "decode_failed", byteSize, sha256 };
  }
  const size = dimensions(bytes, format);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_SIDE || size.height > MAX_SIDE) {
    return { valid: false, reason: "dimensions_out_of_range", byteSize, sha256 };
  }
  return { valid: true, format, ...size, byteSize, sha256 };
}
