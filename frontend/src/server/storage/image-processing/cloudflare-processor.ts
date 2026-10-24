import { MEDIA_VARIANTS, MEDIA_VARIANT_WIDTH, type MediaVariant } from "@/lib/media/image-variants";
import { checkImageContainer } from "./container-check";
import { countImages } from "./metrics";
import {
  IMAGE_PIXEL_LIMIT, VARIANT_MAX_BYTES, VARIANT_QUALITY_STEPS, VERIFIABLE_IMAGE_TYPES,
  type ImageProcessor, type ImageVariant,
} from "./types";

/** The part of the Workers Images binding (`env.IMAGES`) this module uses; the real binding satisfies it. */
export type ImagesBindingLike = {
  info(stream: ReadableStream<Uint8Array>): Promise<{ format: string; width?: number; height?: number }>;
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; fit: "scale-down" }): {
      output(options: { format: "image/webp"; quality: number }): Promise<{ image(): ReadableStream<Uint8Array> }>;
    };
  };
};

/** Images Free plan exhausted (error 9422): new transformations are refused until the month rolls over. */
export class ImageQuotaExceededError extends Error {
  constructor() { super("image processing quota exceeded"); this.name = "ImageQuotaExceededError"; }
}

/** The binding input limit (Images docs: `.input()` accepts up to 20 MB). Every namespace cap is below it. */
const BINDING_INPUT_LIMIT = 20 * 1024 * 1024;
const QUOTA_EXCEEDED = 9422;

/** A fresh copy per call: the binding consumes the stream, and the caller still needs `bytes`. */
const stream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({ start(controller) { controller.enqueue(bytes.slice()); controller.close(); } });

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Workers implementation on the Cloudflare Images binding.
 *
 * Verification = container check (truncation, animation, signature) + `info()`
 * (format and pixel bound, free) + ONE real transform, the thumb variant, which
 * makes Cloudflare decode the whole image. So no image is ever accepted without
 * a full decode, and an exhausted quota fails the upload (never skips the check).
 * The thumb is kept for `variants()` on the same bytes, so an upload with
 * variants costs 3 transformations (thumb, card, full) and one without costs 1.
 * Output is WebP, for which Cloudflare discards all metadata and applies EXIF
 * orientation; `fit: "scale-down"` never upscales.
 */
/** Module-wide, keyed by the verified bytes object: reuse holds even if the binding object differs per request. */
const verifiedThumbs = new WeakMap<Uint8Array, ImageVariant>();

export function createCloudflareImageProcessor(images: ImagesBindingLike): ImageProcessor {

  async function call<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      if ((error as { code?: unknown } | null)?.code === QUOTA_EXCEEDED) {
        countImages("quota");
        console.error(JSON.stringify({ event: "media.images_quota_exceeded", code: QUOTA_EXCEEDED }));
        throw new ImageQuotaExceededError();
      }
      countImages("failure");
      const code = (error as { code?: unknown } | null)?.code;
      console.warn(JSON.stringify({ event: "media.images_failed", code: typeof code === "number" ? code : null }));
      throw new Error("image could not be processed");
    }
  }

  async function encode(bytes: Uint8Array, variant: MediaVariant): Promise<ImageVariant> {
    let output: Uint8Array<ArrayBuffer> | undefined;
    for (const quality of VARIANT_QUALITY_STEPS) {
      output = await call(async () => {
        const result = await images.input(stream(bytes))
          .transform({ width: MEDIA_VARIANT_WIDTH[variant], fit: "scale-down" })
          .output({ format: "image/webp", quality });
        return new Uint8Array(await new Response(result.image()).arrayBuffer());
      });
      countImages("transform");
      if (output.byteLength <= VARIANT_MAX_BYTES) break;
    }
    const encoded = output!;
    const info = await call(() => images.info(stream(encoded)));
    countImages("info");
    if (info.format !== "image/webp" || !info.width || !info.height || encoded.byteLength === 0) throw new Error("image could not be processed");
    return { variant, width: info.width, height: info.height, size: encoded.byteLength, contentType: "image/webp",
      sha256: await sha256Hex(encoded), bytes: encoded };
  }

  return {
    name: "cloudflare-images",
    async verify(bytes, contentType) {
      if (!(VERIFIABLE_IMAGE_TYPES as readonly string[]).includes(contentType) || bytes.byteLength > BINDING_INPUT_LIMIT) {
        throw new Error("unsupported image");
      }
      checkImageContainer(bytes, contentType);
      const info = await call(() => images.info(stream(bytes)));
      countImages("info");
      if (info.format !== contentType || !info.width || !info.height || info.width * info.height > IMAGE_PIXEL_LIMIT) {
        throw new Error("unsupported image");
      }
      verifiedThumbs.set(bytes, await encode(bytes, "thumb"));
    },
    async variants(verifiedBytes) {
      const variants: ImageVariant[] = [];
      for (const variant of MEDIA_VARIANTS) {
        const reused = variant === "thumb" ? verifiedThumbs.get(verifiedBytes) : undefined;
        variants.push(reused ?? await encode(verifiedBytes, variant));
      }
      verifiedThumbs.delete(verifiedBytes);
      return variants;
    },
  };
}
