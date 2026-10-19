/**
 * Downscale and re-encode a photo in the browser before it is uploaded.
 *
 * WHY HERE: a 12 MP phone photo is 3-5 MB and is displayed at most ~1600 px wide.
 * Shrinking it once, before upload, cuts upload time on mobile data, storage and
 * server verification CPU. The uploaded bytes become the retained original.
 *
 * NOT AUTHORITY. Everything here is a size optimisation. The server still reads
 * the stored bytes, decodes them fully and checks type, size and signature
 * (`server/storage/content-validation.mjs`) — a caller that skipped this module
 * uploads a bigger file and nothing else changes.
 *
 * Quality rules, in order:
 *   - never upscale; the long edge is only ever capped;
 *   - EXIF orientation is applied (`imageOrientation: "from-image"`), so the
 *     re-encoded pixels are upright and need no orientation tag;
 *   - WebP when the browser can encode it, else JPEG for opaque sources and PNG
 *     for alpha-capable ones (transparency is never flattened);
 *   - a file that is already small and within the cap is uploaded untouched
 *     (no second generation of lossy compression for no gain);
 *   - the result is kept only when it is actually smaller;
 *   - any failure, or a browser without `createImageBitmap`/canvas, uploads the
 *     original unchanged.
 */

export type ResizeProfile = {
  /** Long-edge cap in pixels. */
  readonly maxEdge: number;
  /** Lossy encoder quality, 0..1. */
  readonly quality: number;
  /** Within the cap and at or below this size, the original is kept as-is. */
  readonly keepBelowBytes: number;
};

/**
 * Per namespace. Photos (portfolio, product) cap at 2560 px: twice the 1600 px
 * `full` variant, so the retained original still supports a sharp lightbox and
 * future larger variants. Certificates are evidence that has to stay legible, so
 * they keep more pixels and a higher quality. Avatars (512) and organization
 * images (640) are cropped to a fixed size by their own fields and only use
 * `encodeCanvas` below.
 */
export const UPLOAD_RESIZE_PROFILES = {
  portfolio: { maxEdge: 2560, quality: 0.85, keepBelowBytes: 1024 * 1024 },
  product: { maxEdge: 2560, quality: 0.85, keepBelowBytes: 1024 * 1024 },
  certificate: { maxEdge: 3200, quality: 0.9, keepBelowBytes: 1536 * 1024 },
} as const satisfies Record<string, ResizeProfile>;

const RESIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Larger sources are left for the server to refuse rather than risking a tab crash. */
const MAX_SOURCE_PIXELS = 60_000_000;

export type EncodedType = "image/webp" | "image/jpeg" | "image/png";

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

/**
 * Halve until within 2x of the target, then one final step. A single large
 * reduction skips source pixels in some browsers and aliases fine detail
 * (tile grout, fabric weave) — exactly what these photos are about.
 */
function drawScaled(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  let source: CanvasImageSource = bitmap;
  let w = bitmap.width;
  let h = bitmap.height;
  while (w > width * 2) {
    w = Math.max(width, Math.round(w / 2));
    h = Math.max(height, Math.round(h / 2));
    source = drawStep(source, w, h);
  }
  return drawStep(source, width, height);
}

const EXTENSION: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

function renamed(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]*$/, "") || "image";
  return `${base}.${EXTENSION[type] ?? "img"}`;
}

export async function resizeImageForUpload(file: File, profile: ResizeProfile): Promise<File> {
  if (!RESIZABLE_TYPES.has(file.type)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  try {
    // eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0 || width * height > MAX_SOURCE_PIXELS) return file;
    const scale = Math.min(1, profile.maxEdge / Math.max(width, height));
    if (scale === 1 && file.size <= profile.keepBelowBytes) return file;
    const canvas = drawScaled(bitmap, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const blob = await encodeCanvas(canvas, profile.quality, file.type === "image/jpeg" ? "image/jpeg" : "image/png");
    if (blob.size <= 0 || blob.size >= file.size) return file;
    return new File([blob], renamed(file.name, blob.type), { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
