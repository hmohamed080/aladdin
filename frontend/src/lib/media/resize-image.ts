/**
 * Prepare a photo in the browser before it is uploaded.
 *
 * THE RULE (owner decision, 2026-10-19): the ORIGINAL a person picks is never
 * refused for its size, its pixel count or its long edge. What the server
 * refuses is a prepared upload over its namespace's ceiling, and this module
 * guarantees the prepared upload meets that ceiling. The only refusal left is
 * "this device could not prepare it": a typed failure the UI shows as a clear,
 * translated message, never a silent server refusal.
 *
 * WHY HERE: the server keeps reading only small, bounded files (the per-bucket
 * caps stay unchanged in SQL and in `server/storage`), so nothing large passes
 * through the web app or Supabase and server decode memory stays bounded. A 48 MP /
 * 20 MB phone photo becomes a 2560 px derivative of a few MB here.
 *
 * NOT AUTHORITY. The server still reads the stored bytes, decodes them fully and
 * checks type, size and signature (`server/storage/content-validation.mjs`,
 * sharp `limitInputPixels` 25 MP). A derivative never exceeds 3200 x 3200 =
 * 10.24 MP, and `fitWithin` clamps to the 25 MP limit whatever a profile says.
 *
 * Quality rules, in order:
 *   - never upscale; the long edge is only ever capped;
 *   - EXIF orientation is applied (`imageOrientation: "from-image"`), so the
 *     re-encoded pixels are upright and need no orientation tag; very large
 *     sources are decoded at reduced size (`resizeWidth`/`resizeHeight`), and a
 *     browser that resizes before rotating is detected and asked again;
 *   - WebP when the browser can encode it (alpha kept), else JPEG for opaque
 *     sources and PNG for sources whose pixels really carry transparency;
 *   - a file within the long edge and at or below `keepBelowBytes` is uploaded
 *     untouched (no second generation of lossy compression for no gain);
 *   - a file within every ceiling is re-encoded only when that is smaller;
 *   - a file over a ceiling is fitted: quality steps down (0.85, 0.75, 0.65,
 *     0.55), then the long edge (x 0.8 per step, not below 1280 px) until the
 *     result is at or below the namespace's byte ceiling.
 */

import { ASSET_POLICY } from "@/lib/storage/professional-assets";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/storage/product-images";
import { REQUEST_IMAGE_MAX_BYTES } from "@/lib/storage/request-images";

export type ResizeProfile = {
  /** Long-edge cap in pixels. */
  readonly maxEdge: number;
  /** First lossy encoder quality, 0..1. */
  readonly quality: number;
  /** Within the cap and at or below this size, the original is kept as-is. */
  readonly keepBelowBytes: number;
  /** The namespace's server-side ceiling. The prepared file never exceeds it. */
  readonly maxBytes: number;
};

/**
 * Per namespace. Photos (portfolio, product, purchase-request reference) cap at
 * 2560 px: twice the 1600 px `full` variant. Certificates are evidence that has
 * to stay legible, so they keep more pixels and a higher quality. Avatars (512)
 * and organization images (640) are cropped to a fixed size by their own fields
 * and use `encodeCanvasWithin` below. `maxBytes` mirrors each bucket's
 * `file_size_limit`, which stays the server's ceiling.
 */
export const UPLOAD_RESIZE_PROFILES = {
  portfolio: { maxEdge: 2560, quality: 0.85, keepBelowBytes: 1024 * 1024, maxBytes: ASSET_POLICY.portfolio.maxBytes },
  product: { maxEdge: 2560, quality: 0.85, keepBelowBytes: 1024 * 1024, maxBytes: PRODUCT_IMAGE_MAX_BYTES },
  request: { maxEdge: 2560, quality: 0.85, keepBelowBytes: 1024 * 1024, maxBytes: REQUEST_IMAGE_MAX_BYTES },
  certificate: { maxEdge: 3200, quality: 0.9, keepBelowBytes: 1536 * 1024, maxBytes: ASSET_POLICY.certificate.maxBytes },
} as const satisfies Record<string, ResizeProfile>;

/** The server's sharp `limitInputPixels`. No derivative may exceed it. */
export const SERVER_DECODE_MAX_PIXELS = 25_000_000;
/** Above this, the source is decoded straight to the target size instead of at full resolution. */
const FULL_DECODE_MAX_PIXELS = 24_000_000;
/** The long edge is never stepped below this while fitting the byte ceiling. */
const MIN_FIT_EDGE = 1280;
const FIT_QUALITIES = [0.75, 0.65, 0.55];
const EDGE_STEP = 0.8;

const RESIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
const ORIENT: ImageBitmapOptions = { imageOrientation: "from-image" };

export type EncodedType = "image/webp" | "image/jpeg" | "image/png";

/**
 * Why a photo could not be prepared. Every reason maps to the same honest
 * message ("This photo could not be prepared on this device. Try a smaller copy.").
 *   decode       the browser could not decode the image (or not at a size it can hold);
 *   canvas       the browser could not draw or encode it (for example a canvas-area limit);
 *   fit          even at the lowest quality and the smallest edge it is over the ceiling;
 *   unsupported  the browser has no `createImageBitmap`/canvas and the file needs preparing.
 */
export type ImagePrepareFailure = "decode" | "canvas" | "fit" | "unsupported";
export type PreparedImage = { ok: true; file: File } | { ok: false; reason: ImagePrepareFailure };

/** Thrown by `encodeCanvasWithin` so a crop field can tell "could not prepare" from "could not upload". */
export class ImagePrepareError extends Error {
  constructor(readonly reason: ImagePrepareFailure) {
    super(`image prepare failed: ${reason}`);
    this.name = "ImagePrepareError";
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * WebP first. A browser that cannot encode WebP silently returns PNG from
 * `toBlob`, so the returned type is checked rather than trusted, and the
 * declared `fallback` is used instead.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement, quality: number, fallback: "image/jpeg" | "image/png"): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  const other = await toBlob(canvas, fallback, quality);
  if (!other) throw new Error("image encode failed");
  return other;
}

/**
 * Encode a fixed-size canvas (the avatar and organization crops) at or below
 * `maxBytes`, stepping quality down when needed. Throws `ImagePrepareError`
 * rather than letting an oversized blob reach the server. At 512/640 px this
 * never fails in practice (a 640 px RGBA PNG is at most ~1.6 MB raw), but the
 * guarantee is stated in code rather than in arithmetic.
 */
export async function encodeCanvasWithin(
  canvas: HTMLCanvasElement,
  quality: number,
  fallback: "image/jpeg" | "image/png",
  maxBytes: number,
): Promise<Blob> {
  for (const q of [quality, ...FIT_QUALITIES.filter((step) => step < quality)]) {
    let blob: Blob;
    try { blob = await encodeCanvas(canvas, q, fallback); }
    catch { throw new ImagePrepareError("canvas"); }
    if (blob.size > 0 && blob.size <= maxBytes) return blob;
    if (blob.type === "image/png") break; // lossless: quality changes nothing
  }
  throw new ImagePrepareError("fit");
}

/**
 * True when any pixel is not fully opaque. Asked only when the browser cannot
 * encode WebP and the fallback would be PNG: an opaque "PNG" photo is then
 * written as JPEG, which is what lets it fit. A context that cannot read pixels
 * answers "yes", so transparency is never flattened on a guess.
 */
const transparency = new WeakMap<HTMLCanvasElement, boolean>();
function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const known = transparency.get(canvas);
  if (known !== undefined) return known;
  const answer = scanTransparency(canvas);
  transparency.set(canvas, answer);
  return answer;
}

function scanTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context || typeof context.getImageData !== "function") return true;
  try {
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
    return false;
  } catch {
    return true;
  }
}

function drawStep(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Release a canvas's backing store now rather than at garbage collection (matters on phones). */
function release(canvas: HTMLCanvasElement | undefined) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}

/**
 * Halve until within 2x of the target, then one final step. A single large
 * reduction skips source pixels in some browsers and aliases fine detail
 * (tile grout, fabric weave): exactly what these photos are about.
 */
function drawScaled(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  let source: CanvasImageSource = bitmap;
  let intermediate: HTMLCanvasElement | undefined;
  let w = bitmap.width;
  let h = bitmap.height;
  while (w > width * 2) {
    w = Math.max(width, Math.round(w / 2));
    h = Math.max(height, Math.round(h / 2));
    const next = drawStep(source, w, h);
    release(intermediate);
    intermediate = next;
    source = next;
  }
  const result = drawStep(source, width, height);
  release(intermediate);
  return result;
}

// ---------------------------------------------------------------------------
// Header: dimensions and EXIF orientation without decoding a pixel
// ---------------------------------------------------------------------------

/** Upright dimensions, as the person sees the photo. */
export type ImageHeader = { width: number; height: number };

async function readBytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

const u16 = (b: Uint8Array, i: number, le: boolean) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
const u32 = (b: Uint8Array, i: number, le: boolean) =>
  le ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0
    : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** EXIF orientation (1..8) from an APP1 payload that starts at "Exif\0\0"; 1 when absent. */
function exifOrientation(segment: Uint8Array): number {
  if (segment.length < 14 || ascii(segment, 0, 4) !== "Exif") return 1;
  const tiff = 6;
  const le = segment[tiff] === 0x49;
  const ifd = tiff + u32(segment, tiff + 4, le);
  if (ifd + 2 > segment.length) return 1;
  const entries = u16(segment, ifd, le);
  for (let n = 0; n < entries; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 10 > segment.length) break;
    if (u16(segment, entry, le) === 0x0112) {
      const value = u16(segment, entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

async function jpegHeader(file: Blob): Promise<ImageHeader | null> {
  let offset = 2;
  let orientation = 1;
  for (let guard = 0; guard < 256 && offset + 4 <= file.size; guard++) {
    const head = await readBytes(file, offset, 4);
    if (head[0] !== 0xff) return null;
    const marker = head[1]!;
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any frame header
    const length = u16(head, 2, false);
    if (length < 2) return null;
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(await readBytes(file, offset + 4, length - 2));
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const sof = await readBytes(file, offset + 4, 5);
      const height = u16(sof, 1, false);
      const width = u16(sof, 3, false);
      if (!width || !height) return null;
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Upright dimensions from the file's header, or null when it cannot be read
 * (the image is then decoded at full size, as before). WebP EXIF orientation is
 * rare and not read; its dimensions are taken as stored.
 */
export async function readImageHeader(file: Blob, type: string): Promise<ImageHeader | null> {
  try {
    if (type === "image/jpeg") {
      const soi = await readBytes(file, 0, 2);
      return soi[0] === 0xff && soi[1] === 0xd8 ? await jpegHeader(file) : null;
    }
    const b = await readBytes(file, 0, 32);
    if (b.length < 30) return null;
    if (type === "image/png") {
      if (b[0] !== 0x89 || b[1] !== 0x50 || ascii(b, 12, 16) !== "IHDR") return null;
      const width = u32(b, 16, false);
      const height = u32(b, 20, false);
      return width && height ? { width, height } : null;
    }
    if (type === "image/webp") {
      if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return null;
      const chunk = ascii(b, 12, 16);
      if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
      if (chunk === "VP8L") {
        return {
          width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
          height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
        };
      }
      if (chunk === "VP8 ") {
        const width = u16(b, 26, true) & 0x3fff;
        const height = u16(b, 28, true) & 0x3fff;
        return width && height ? { width, height } : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode upright. Above FULL_DECODE_MAX_PIXELS the browser is asked for the
 * target size directly, so a 120 MP source never becomes a 480 MB bitmap.
 *
 * ORIENTATION WITH RESIZE: the spec resizes the upright image, but some engines
 * resized the stored (sensor) image and rotated afterwards, which turns the
 * requested W x H box into H x W and squashes the picture. That case is detected
 * (the bitmap comes back swapped) and the box is asked again swapped, which such
 * an engine then rotates into the right shape. A browser that rejects the
 * resize options falls back to a full-size decode; one that ignores them
 * returns a full-size bitmap, which the canvas path then scales.
 */
async function decodeUpright(file: File, header: ImageHeader | null, maxEdge: number): Promise<ImageBitmap> {
  if (!header || header.width * header.height <= FULL_DECODE_MAX_PIXELS) return createImageBitmap(file, ORIENT);
  const scale = Math.min(1, maxEdge / Math.max(header.width, header.height));
  const width = Math.max(1, Math.round(header.width * scale));
  const height = Math.max(1, Math.round(header.height * scale));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { ...ORIENT, resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  } catch {
    return createImageBitmap(file, ORIENT);
  }
  if (width !== height && bitmap.width === height && bitmap.height === width) {
    bitmap.close();
    bitmap = await createImageBitmap(file, { ...ORIENT, resizeWidth: height, resizeHeight: width, resizeQuality: "high" });
  }
  return bitmap;
}

// ---------------------------------------------------------------------------
// Encode and fit
// ---------------------------------------------------------------------------

const EXTENSION: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

function asFile(blob: Blob, original: File): File {
  const base = original.name.replace(/\.[^./\\]*$/, "") || "image";
  return new File([blob], `${base}.${EXTENSION[blob.type] ?? "img"}`, { type: blob.type, lastModified: original.lastModified });
}

/** WebP, else JPEG for opaque sources, else PNG only when the pixels really carry transparency. */
async function encodeFor(canvas: HTMLCanvasElement, quality: number, sourceType: string): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp" && webp.size > 0) return webp;
  const type = sourceType === "image/jpeg" || !hasTransparency(canvas) ? "image/jpeg" : "image/png";
  const other = await toBlob(canvas, type, quality);
  if (!other || other.size <= 0) throw new Error("image encode failed");
  return other;
}

type Fitted = { ok: true; blob: Blob } | { ok: false; reason: ImagePrepareFailure };

/** Quality first, then the long edge, until the blob is at or below `profile.maxBytes`. */
async function fitWithin(bitmap: ImageBitmap, profile: ResizeProfile, sourceType: string): Promise<Fitted> {
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const aspect = longEdge / Math.min(bitmap.width, bitmap.height);
  // The second bound keeps every derivative inside the server's decode limit whatever a profile says.
  let edge = Math.min(profile.maxEdge, longEdge, Math.floor(Math.sqrt(SERVER_DECODE_MAX_PIXELS * aspect)));
  const floor = Math.min(MIN_FIT_EDGE, edge);
  const qualities = [profile.quality, ...FIT_QUALITIES.filter((q) => q < profile.quality)];
  for (;;) {
    const scale = edge / longEdge;
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = drawScaled(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      for (const q of qualities) {
        const blob = await encodeFor(canvas, q, sourceType);
        if (blob.size <= profile.maxBytes) return { ok: true, blob };
        if (blob.type === "image/png") break; // lossless: only fewer pixels help
      }
    } catch {
      return { ok: false, reason: "canvas" };
    } finally {
      release(canvas);
    }
    if (edge <= floor) return { ok: false, reason: "fit" };
    edge = Math.max(floor, Math.floor(edge * EDGE_STEP));
  }
}

/**
 * Prepare `file` for upload under `profile`. Types other than JPEG/PNG/WebP (a
 * certificate PDF) pass through untouched: type rules are the caller's.
 */
export async function resizeImageForUpload(file: File, profile: ResizeProfile): Promise<PreparedImage> {
  if (!RESIZABLE_TYPES.has(file.type)) return { ok: true, file };
  const header = await readImageHeader(file, file.type);
  const overBytes = file.size > profile.maxBytes;
  const overEdge = header !== null && Math.max(header.width, header.height) > profile.maxEdge;
  const overPixels = header !== null && header.width * header.height > SERVER_DECODE_MAX_PIXELS;
  const mustFit = overBytes || overEdge || overPixels;
  if (!mustFit && header && file.size <= profile.keepBelowBytes) return { ok: true, file };

  const capable = typeof createImageBitmap === "function" && typeof document !== "undefined";
  if (!capable) return mustFit ? { ok: false, reason: "unsupported" } : { ok: true, file };

  let bitmap: ImageBitmap | undefined;
  try {
    try { bitmap = await decodeUpright(file, header, profile.maxEdge); }
    catch { return mustFit ? { ok: false, reason: "decode" } : { ok: true, file }; }
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) return mustFit ? { ok: false, reason: "decode" } : { ok: true, file };
    // Without a readable header, the full decode is the first look at the dimensions.
    const needsFit = mustFit || Math.max(width, height) > profile.maxEdge || width * height > SERVER_DECODE_MAX_PIXELS;
    if (!needsFit && file.size <= profile.keepBelowBytes) return { ok: true, file };

    if (needsFit) {
      const fitted = await fitWithin(bitmap, profile, file.type);
      return fitted.ok ? { ok: true, file: asFile(fitted.blob, file) } : fitted;
    }

    // Within every ceiling: one re-encode, kept only when it is actually smaller.
    let canvas: HTMLCanvasElement | undefined;
    try {
      canvas = drawScaled(bitmap, width, height);
      const blob = await encodeFor(canvas, profile.quality, file.type);
      return { ok: true, file: blob.size < file.size ? asFile(blob, file) : file };
    } catch {
      return { ok: true, file };
    } finally {
      release(canvas);
    }
  } finally {
    bitmap?.close();
  }
}
