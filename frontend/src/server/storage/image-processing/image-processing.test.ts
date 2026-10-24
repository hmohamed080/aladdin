import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { sharpImageProcessor } from "./sharp-processor";
import { createCloudflareImageProcessor, ImageQuotaExceededError, type ImagesBindingLike } from "./cloudflare-processor";
import { imageProcessingMetrics, resetImageProcessingMetrics } from "./metrics";
import type { ImageProcessor } from "./types";

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "white" } });
const read = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());

/**
 * Stand-in for `env.IMAGES` built on sharp, deliberately LENIENT (`failOn: "none"`,
 * renders what it can of a damaged file) so the tests show the Workers processor
 * does not rely on the engine to refuse a truncated upload.
 */
function fakeImagesBinding(options: { failOn?: (call: number) => number | null } = {}) {
  const calls = { info: 0, transforms: [] as Array<{ width: number; quality: number }> };
  const fail = (call: number) => {
    const code = options.failOn?.(call);
    if (code != null) throw Object.assign(new Error(`IMAGES_TRANSFORM_ERROR ${code}`), { code });
  };
  const binding: ImagesBindingLike = {
    async info(stream) {
      calls.info++;
      const meta = await sharp(await read(stream), { failOn: "none" }).metadata();
      return { format: `image/${meta.format}`, width: meta.width, height: meta.height };
    },
    input(stream) {
      return {
        transform: ({ width }) => ({
          async output({ quality }) {
            calls.transforms.push({ width, quality });
            fail(calls.transforms.length);
            const data = await sharp(await read(stream), { failOn: "none" }).rotate()
              .resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
            return { image: () => new Response(new Uint8Array(data)).body! };
          },
        }),
      };
    },
  };
  return { binding, calls };
}

async function fixtures() {
  const jpeg = await solid(2400, 1200).jpeg().toBuffer();
  return {
    jpeg,
    png: await solid(800, 400).png().toBuffer(),
    webp: await solid(640, 480).webp().toBuffer(),
    truncatedJpeg: jpeg.subarray(0, Math.floor(jpeg.length * 0.6)),
    rotatedJpeg: await solid(600, 300).withMetadata({ orientation: 6 }).jpeg().toBuffer(),
  };
}

/** The contract both engines must keep: identical verification and variant results. */
const engines: Array<[string, () => ImageProcessor]> = [
  ["sharp (Node / Vercel)", () => sharpImageProcessor],
  ["Cloudflare Images (Workers)", () => createCloudflareImageProcessor(fakeImagesBinding().binding)],
];

describe.each(engines)("image processor contract: %s", (_name, make) => {
  it("accepts complete JPEG, PNG and WebP of the declared type", async () => {
    const f = await fixtures();
    const engine = make();
    await expect(engine.verify(f.jpeg, "image/jpeg")).resolves.toBeUndefined();
    await expect(engine.verify(f.png, "image/png")).resolves.toBeUndefined();
    await expect(engine.verify(f.webp, "image/webp")).resolves.toBeUndefined();
  });

  it("refuses a type mismatch, a truncated file, non-images and animation", async () => {
    const f = await fixtures();
    const engine = make();
    await expect(engine.verify(f.png, "image/jpeg")).rejects.toThrow();
    await expect(engine.verify(f.truncatedJpeg, "image/jpeg")).rejects.toThrow();
    await expect(engine.verify(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png")).rejects.toThrow();
    await expect(engine.verify(animatedWebp(), "image/webp")).rejects.toThrow();
  });

  it("refuses more than 25 MP without decoding it", async () => {
    const huge = await solid(5001, 5001).png({ compressionLevel: 9 }).toBuffer();
    await expect(make().verify(huge, "image/png")).rejects.toThrow();
  });

  it("produces thumb/card/full WebP at 320/768/1600, no upscaling, EXIF applied then stripped", async () => {
    const f = await fixtures();
    const engine = make();
    await engine.verify(f.jpeg, "image/jpeg");
    const variants = await engine.variants(f.jpeg);
    expect(variants.map((v) => [v.variant, v.width, v.height])).toEqual([["thumb", 320, 160], ["card", 768, 384], ["full", 1600, 800]]);
    for (const v of variants) {
      const meta = await sharp(v.bytes).metadata();
      expect([meta.format, meta.width, meta.height, v.size]).toEqual(["webp", v.width, v.height, v.bytes.byteLength]);
      expect(v.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect((await engine.variants(f.png)).map((v) => v.width)).toEqual([320, 768, 800]);
    const [thumb] = await engine.variants(f.rotatedJpeg);
    const meta = await sharp(thumb!.bytes).metadata();
    expect([meta.width, meta.height, meta.exif, meta.orientation]).toEqual([300, 600, undefined, undefined]);
  });
});

describe("Cloudflare Images processor (Workers)", () => {
  beforeEach(() => resetImageProcessingMetrics());

  it("verifies with one real transform and reuses it: an upload with variants costs 3", async () => {
    const f = await fixtures();
    const { binding, calls } = fakeImagesBinding();
    const engine = createCloudflareImageProcessor(binding);
    await engine.verify(f.jpeg, "image/jpeg");
    expect(calls.transforms).toEqual([{ width: 320, quality: 80 }]);
    await engine.variants(f.jpeg);
    expect(calls.transforms.map((t) => t.width)).toEqual([320, 768, 1600]);
    expect(imageProcessingMetrics()).toMatchObject({ transforms: 3, quotaExceeded: 0, failures: 0 });
  });

  it("refuses a truncated JPEG before calling the binding, even though the engine would render it", async () => {
    const f = await fixtures();
    const { binding, calls } = fakeImagesBinding();
    await expect(sharp(f.truncatedJpeg, { failOn: "none" }).webp().toBuffer()).resolves.toBeDefined();
    await expect(createCloudflareImageProcessor(binding).verify(f.truncatedJpeg, "image/jpeg")).rejects.toThrow("unsupported image");
    expect([calls.info, calls.transforms.length]).toEqual([0, 0]);
  });

  it("fails verification on an exhausted quota (9422): counted, logged, never skipped", async () => {
    const f = await fixtures();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { binding } = fakeImagesBinding({ failOn: () => 9422 });
    await expect(createCloudflareImageProcessor(binding).verify(f.jpeg, "image/jpeg")).rejects.toBeInstanceOf(ImageQuotaExceededError);
    expect(imageProcessingMetrics()).toMatchObject({ quotaExceeded: 1, transforms: 0 });
    expect(imageProcessingMetrics().lastQuotaExceededAgoMs).not.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("media.images_quota_exceeded"));
    error.mockRestore();
  });

  it("surfaces a quota hit while deriving variants (the caller treats variants as best-effort)", async () => {
    const f = await fixtures();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { binding } = fakeImagesBinding({ failOn: (call) => (call === 2 ? 9422 : null) });
    const engine = createCloudflareImageProcessor(binding);
    await engine.verify(f.jpeg, "image/jpeg");
    await expect(engine.variants(f.jpeg)).rejects.toBeInstanceOf(ImageQuotaExceededError);
    error.mockRestore();
  });

  it("turns other engine errors into a generic refusal without provider text", async () => {
    const f = await fixtures();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { binding } = fakeImagesBinding({ failOn: () => 9523 });
    await expect(createCloudflareImageProcessor(binding).verify(f.jpeg, "image/jpeg")).rejects.toThrow("image could not be processed");
    expect(imageProcessingMetrics()).toMatchObject({ failures: 1, quotaExceeded: 0 });
    warn.mockRestore();
  });

  it("steps quality down when a variant is over budget", async () => {
    const { randomBytes } = await import("node:crypto");
    const noise = await sharp(randomBytes(1700 * 1100 * 3), { raw: { width: 1700, height: 1100, channels: 3 } }).png().toBuffer();
    const { binding, calls } = fakeImagesBinding();
    const variants = await createCloudflareImageProcessor(binding).variants(noise);
    expect(calls.transforms.filter((t) => t.width === 1600).map((t) => t.quality)[1]).toBe(72);
    expect(variants.find((v) => v.variant === "full")!.size).toBeLessThan(
      (await sharp(noise).resize({ width: 1600 }).webp({ quality: 80 }).toBuffer()).byteLength);
  });
});

describe("Workers runtime selection", () => {
  it("uses env.IMAGES and refuses to run without it", async () => {
    vi.resetModules();
    const context = { env: {} as Record<string, unknown> };
    vi.doMock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => context }));
    const { runtimeImageProcessor } = await import("./runtime.workers");
    expect(() => runtimeImageProcessor()).toThrow("IMAGES");
    context.env.IMAGES = fakeImagesBinding().binding;
    expect(runtimeImageProcessor().name).toBe("cloudflare-images");
    vi.doUnmock("@opennextjs/cloudflare");
  });

  it("Node keeps sharp", async () => {
    const { runtimeImageProcessor } = await import("./runtime");
    expect(runtimeImageProcessor().name).toBe("sharp");
  });
});

/** A WebP whose VP8X header declares animation (with an ANIM chunk), around a still frame. */
function animatedWebp(): Uint8Array {
  const chunk = (type: string, payload: number[]) => {
    const size = payload.length;
    return [...type].map((c) => c.charCodeAt(0)).concat([size & 255, (size >> 8) & 255, 0, 0], payload, size & 1 ? [0] : []);
  };
  const body = [...chunk("VP8X", [0x02, 0, 0, 0, 19, 0, 0, 19, 0, 0]), ...chunk("ANIM", [0, 0, 0, 0, 0, 0])];
  const riff = [..."WEBP"].map((c) => c.charCodeAt(0)).concat(body);
  const n = riff.length;
  return new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([n & 255, (n >> 8) & 255, 0, 0], riff));
}
