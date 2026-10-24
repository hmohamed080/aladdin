import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeCanvas,
  encodeCanvasWithin,
  ImagePrepareError,
  readImageHeader,
  resizeImageForUpload,
  SERVER_DECODE_MAX_PIXELS,
  UPLOAD_RESIZE_PROFILES,
  type PreparedImage,
} from "./resize-image";

/**
 * A canvas double. It records every draw and returns a blob whose size is set
 * by the test, and whose type mimics a browser: one that cannot encode WebP
 * hands back PNG instead (which is what Safari's `toBlob` historically did).
 */
type Encoder = (type: string, quality: number, canvas: FakeCanvas) => { type: string; size: number } | null;
type FakeCanvas = { width: number; height: number; draws: Array<[number, number]>; getContext: () => unknown; toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => void };
type BitmapOptions = { resizeWidth?: number; resizeHeight?: number; resizeQuality?: string; imageOrientation?: string };
type FakeBitmap = { width: number; height: number; close: ReturnType<typeof vi.fn> };

let canvases: FakeCanvas[];
let encoder: Encoder;
/** null: the context cannot read pixels; otherwise every pixel's alpha. */
let pixelAlpha: number | null;
let bitmap: FakeBitmap;
/** Default engine: honours resize options exactly, else returns the full-size `bitmap`. */
const engine = async (_file: Blob, options?: BitmapOptions): Promise<FakeBitmap> =>
  options?.resizeWidth ? { width: options.resizeWidth, height: options.resizeHeight!, close: bitmap.close } : bitmap;
const createImageBitmap = vi.fn(engine);

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0, height: 0, draws: [],
    getContext: () => ({ imageSmoothingEnabled: false, imageSmoothingQuality: "low",
      drawImage: (_s: unknown, _x: number, _y: number, w: number, h: number) => canvas.draws.push([w, h]),
      ...(pixelAlpha === null ? {} : { getImageData: (_x: number, _y: number, w: number, h: number) =>
        ({ data: new Uint8ClampedArray(w * h * 4).fill(pixelAlpha!) }) }) }),
    toBlob: (cb, type, q) => {
      const out = encoder(type, q, canvas);
      cb(out ? new Blob([new Uint8Array(out.size)], { type: out.type }) : null);
    },
  };
  canvases.push(canvas);
  return canvas;
}

const MiB = 1024 * 1024;
const file = (size: number, type = "image/jpeg", name = "IMG_0001.JPG") =>
  new File([new Uint8Array(size)], name, { type, lastModified: 42 });

/** A JPEG whose header carries real dimensions (and, optionally, an EXIF orientation), padded to `size`. */
function jpeg(width: number, height: number, size: number, orientation?: number): File {
  const bytes = new Uint8Array(size);
  let o = 0;
  bytes.set([0xff, 0xd8], o); o += 2;
  if (orientation) {
    // APP1: "Exif\0\0" + big-endian TIFF header + one IFD entry (0x0112, SHORT, count 1, value).
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
    bytes.set([0xff, 0xe1, 0, app1.length + 2, ...app1], o); o += 4 + app1.length;
  }
  bytes.set([0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3], o);
  return new File([bytes], "IMG_0001.JPG", { type: "image/jpeg", lastModified: 42 });
}

function png(width: number, height: number, size: number): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "logo.png", { type: "image/png", lastModified: 42 });
}

function prepared(result: PreparedImage): File {
  if (!result.ok) throw new Error(`expected a prepared file, got ${result.reason}`);
  return result.file;
}

/** Canvases are released (zeroed) after use, so the drawn size is the record. */
const lastCanvas = () => canvases.at(-1)!.draws.at(-1)!;

beforeEach(() => {
  canvases = [];
  pixelAlpha = null;
  bitmap = { width: 4032, height: 3024, close: vi.fn() };
  encoder = (type) => ({ type, size: 600_000 });
  createImageBitmap.mockReset();
  createImageBitmap.mockImplementation(engine);
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : null) });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("resizeImageForUpload", () => {
  it("caps the long edge at 2560 px, applies EXIF orientation and re-encodes to WebP", async () => {
    const out = prepared(await resizeImageForUpload(file(4_000_000), UPLOAD_RESIZE_PROFILES.portfolio));
    // eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(lastCanvas()).toEqual([2560, 1920]);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("IMG_0001.webp");
    expect(out.size).toBe(600_000);
    expect(out.lastModified).toBe(42);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("downsamples in halving steps for large reductions", async () => {
    bitmap = { width: 8000, height: 6000, close: vi.fn() };
    await resizeImageForUpload(file(4_900_000), UPLOAD_RESIZE_PROFILES.portfolio);
    expect(canvases.map((c) => c.draws[0])).toEqual([[4000, 3000], [2560, 1920]]);
  });

  it("brings a 20 MB, 48 MP JPEG to at most 5 MiB, stepping quality down", async () => {
    const qualities: number[] = [];
    // An encoder whose output grows with pixels and quality: 2560 x 1920 at 0.85 is ~6.3 MB.
    encoder = (type, q, c) => { qualities.push(q); return { type, size: Math.round(c.width * c.height * q * 1.5) }; };
    const out = prepared(await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.portfolio));
    expect(out.size).toBeLessThanOrEqual(5 * MiB);
    expect(out.type).toBe("image/webp");
    expect(qualities).toEqual([0.85, 0.75, 0.65]);
    expect(lastCanvas()).toEqual([2560, 1920]);
  });

  it("decodes a 120 MP source at reduced size, upright, with high-quality resize options", async () => {
    const out = prepared(await resizeImageForUpload(jpeg(12_000, 10_000, 45 * MiB), UPLOAD_RESIZE_PROFILES.portfolio));
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image", resizeWidth: 2560, resizeHeight: 2133, resizeQuality: "high" });
    expect(lastCanvas()).toEqual([2560, 2133]);
    expect(2560 * 2133).toBeLessThan(SERVER_DECODE_MAX_PIXELS);
    expect(out.size).toBeLessThanOrEqual(5 * MiB);
  });

  it("asks again with a swapped box when the engine resized before rotating", async () => {
    // Sensor 8000 x 6000, EXIF orientation 6: upright the photo is 6000 x 8000 (portrait).
    // This engine applies the box to the stored image and rotates afterwards.
    createImageBitmap.mockImplementation(async (_f, options) =>
      ({ width: options!.resizeHeight!, height: options!.resizeWidth!, close: bitmap.close }));
    await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB, 6), UPLOAD_RESIZE_PROFILES.portfolio);
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(createImageBitmap.mock.calls[0]![1]).toMatchObject({ resizeWidth: 1920, resizeHeight: 2560 });
    expect(createImageBitmap.mock.calls[1]![1]).toMatchObject({ resizeWidth: 2560, resizeHeight: 1920 });
    expect(lastCanvas()).toEqual([1920, 2560]);
  });

  it("falls back to a full decode when the browser rejects resize options", async () => {
    createImageBitmap.mockImplementationOnce(async () => { throw new TypeError("unsupported option"); });
    bitmap = { width: 12_000, height: 10_000, close: vi.fn() };
    const out = prepared(await resizeImageForUpload(jpeg(12_000, 10_000, 45 * MiB), UPLOAD_RESIZE_PROFILES.portfolio));
    // eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
    expect(createImageBitmap).toHaveBeenLastCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(lastCanvas()).toEqual([2560, 2133]);
    expect(out.type).toBe("image/webp");
  });

  it("steps the long edge down by 0.8 when quality alone cannot fit", async () => {
    encoder = (type, _q, c) => ({ type, size: Math.round(c.width * c.height * 1.5) });
    const out = prepared(await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.portfolio));
    expect(lastCanvas()).toEqual([2048, 1536]);
    expect(out.size).toBeLessThanOrEqual(5 * MiB);
  });

  it("returns a typed failure when the image cannot be fitted, never an oversized file", async () => {
    encoder = (type) => ({ type, size: 6 * MiB });
    const result = await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.portfolio);
    expect(result).toEqual({ ok: false, reason: "fit" });
    expect(Math.max(...lastCanvas())).toBe(1280);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("returns a typed failure when the canvas cannot be encoded (a canvas-area limit)", async () => {
    encoder = () => null;
    expect(await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.portfolio)).toEqual({ ok: false, reason: "canvas" });
  });

  it("returns a typed failure when a large source cannot be decoded", async () => {
    createImageBitmap.mockRejectedValue(new Error("decode failed"));
    expect(await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.portfolio)).toEqual({ ok: false, reason: "decode" });
  });

  it("returns a typed failure when the browser cannot prepare a file that needs it", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await resizeImageForUpload(jpeg(8000, 6000, 20 * MiB), UPLOAD_RESIZE_PROFILES.product)).toEqual({ ok: false, reason: "unsupported" });
    const small = jpeg(1200, 900, 2 * MiB);
    expect(prepared(await resizeImageForUpload(small, UPLOAD_RESIZE_PROFILES.product))).toBe(small);
  });

  it("leaves a small file within the edge untouched, without decoding it", async () => {
    const small = jpeg(1600, 1200, 400_000);
    expect(prepared(await resizeImageForUpload(small, UPLOAD_RESIZE_PROFILES.portfolio))).toBe(small);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
  });

  it("never upscales, and keeps an in-bounds original unless re-encoding makes it smaller", async () => {
    bitmap = { width: 1200, height: 900, close: vi.fn() };
    const heavy = prepared(await resizeImageForUpload(file(2_000_000, "image/png", "scan.png"), UPLOAD_RESIZE_PROFILES.portfolio));
    expect(lastCanvas()).toEqual([1200, 900]);
    expect(heavy.type).toBe("image/webp");
    encoder = (type) => ({ type, size: 3_000_000 });
    const original = file(2_000_000);
    expect(prepared(await resizeImageForUpload(original, UPLOAD_RESIZE_PROFILES.portfolio))).toBe(original);
  });

  it("keeps transparency: WebP when available, else PNG for a source that really has alpha", async () => {
    const webp = prepared(await resizeImageForUpload(png(4000, 3000, 9 * MiB), UPLOAD_RESIZE_PROFILES.product));
    expect(webp.type).toBe("image/webp");
    expect(webp.name).toBe("logo.webp");
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 500_000 });
    pixelAlpha = 128;
    expect(prepared(await resizeImageForUpload(png(4000, 3000, 9 * MiB), UPLOAD_RESIZE_PROFILES.product)).type).toBe("image/png");
    pixelAlpha = null; // pixels unreadable: never flatten on a guess
    expect(prepared(await resizeImageForUpload(png(4000, 3000, 9 * MiB), UPLOAD_RESIZE_PROFILES.product)).type).toBe("image/png");
  });

  it("writes an opaque PNG as JPEG when WebP is unavailable, and JPEG sources as JPEG", async () => {
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 500_000 });
    pixelAlpha = 255;
    expect(prepared(await resizeImageForUpload(png(4000, 3000, 9 * MiB), UPLOAD_RESIZE_PROFILES.product)).type).toBe("image/jpeg");
    expect(prepared(await resizeImageForUpload(file(4_000_000), UPLOAD_RESIZE_PROFILES.product)).type).toBe("image/jpeg");
  });

  it("leaves PDFs and unsupported types to the caller's type rules", async () => {
    const pdf = file(40 * MiB, "application/pdf", "cert.pdf");
    expect(prepared(await resizeImageForUpload(pdf, UPLOAD_RESIZE_PROFILES.certificate))).toBe(pdf);
    const gif = file(2_000_000, "image/gif", "a.gif");
    expect(prepared(await resizeImageForUpload(gif, UPLOAD_RESIZE_PROFILES.portfolio))).toBe(gif);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("uploads an in-bounds original the browser cannot decode; the server judges it", async () => {
    createImageBitmap.mockRejectedValueOnce(new Error("decode failed"));
    const broken = file(4_000_000);
    expect(prepared(await resizeImageForUpload(broken, UPLOAD_RESIZE_PROFILES.portfolio))).toBe(broken);
  });

  it("keeps certificates legible: a higher cap and quality, and a 10 MiB ceiling", async () => {
    bitmap = { width: 6000, height: 4000, close: vi.fn() };
    const qualities: number[] = [];
    encoder = (type, q) => { qualities.push(q); return { type, size: 9 * MiB }; };
    const out = prepared(await resizeImageForUpload(file(30 * MiB), UPLOAD_RESIZE_PROFILES.certificate));
    expect(lastCanvas()).toEqual([3200, 2133]);
    expect(qualities).toEqual([0.9]);
    expect(out.size).toBe(9 * MiB);
  });

  it("has a byte ceiling per namespace that mirrors the server caps, and stays inside the server decode limit", () => {
    expect(UPLOAD_RESIZE_PROFILES.portfolio.maxBytes).toBe(5 * MiB);
    expect(UPLOAD_RESIZE_PROFILES.product.maxBytes).toBe(5 * MiB);
    expect(UPLOAD_RESIZE_PROFILES.request.maxBytes).toBe(5 * MiB);
    expect(UPLOAD_RESIZE_PROFILES.certificate.maxBytes).toBe(10 * MiB);
    for (const profile of Object.values(UPLOAD_RESIZE_PROFILES)) {
      expect(profile.maxEdge * profile.maxEdge).toBeLessThan(SERVER_DECODE_MAX_PIXELS);
    }
  });
});

describe("readImageHeader", () => {
  it("reads upright JPEG dimensions, honouring EXIF orientation", async () => {
    expect(await readImageHeader(jpeg(4032, 3024, 1000), "image/jpeg")).toEqual({ width: 4032, height: 3024 });
    expect(await readImageHeader(jpeg(4032, 3024, 1000, 6), "image/jpeg")).toEqual({ width: 3024, height: 4032 });
    expect(await readImageHeader(jpeg(4032, 3024, 1000, 3), "image/jpeg")).toEqual({ width: 4032, height: 3024 });
  });

  it("reads PNG and WebP (VP8X) dimensions, and answers null for anything else", async () => {
    expect(await readImageHeader(png(5000, 4000, 100), "image/png")).toEqual({ width: 5000, height: 4000 });
    const webp = new Uint8Array(64);
    webp.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X")]);
    webp.set([0x3f, 0x1f, 0x00, 0x9f, 0x0f, 0x00], 24); // 8000 x 4000, each stored minus one
    expect(await readImageHeader(new Blob([webp]), "image/webp")).toEqual({ width: 8000, height: 4000 });
    expect(await readImageHeader(new Blob([new Uint8Array(64)]), "image/png")).toBeNull();
  });
});

describe("encodeCanvas", () => {
  it("checks the produced type instead of trusting the request", async () => {
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 1 });
    const blob = await encodeCanvas(fakeCanvas() as unknown as HTMLCanvasElement, 0.85, "image/jpeg");
    expect(blob.type).toBe("image/jpeg");
  });
});

describe("encodeCanvasWithin (avatar and organization crops)", () => {
  it("steps quality down until the crop fits the bucket ceiling", async () => {
    const qualities: number[] = [];
    encoder = (type, q) => { qualities.push(q); return { type, size: q > 0.7 ? 4 * MiB : 2 * MiB }; };
    const blob = await encodeCanvasWithin(fakeCanvas() as unknown as HTMLCanvasElement, 0.9, "image/jpeg", 3 * MiB);
    expect(blob.size).toBe(2 * MiB);
    expect(qualities).toEqual([0.9, 0.75, 0.65]);
  });

  it("throws a typed error instead of returning an oversized blob", async () => {
    encoder = (type) => ({ type, size: 4 * MiB });
    await expect(encodeCanvasWithin(fakeCanvas() as unknown as HTMLCanvasElement, 0.9, "image/jpeg", 3 * MiB)).rejects.toBeInstanceOf(ImagePrepareError);
    encoder = () => null;
    await expect(encodeCanvasWithin(fakeCanvas() as unknown as HTMLCanvasElement, 0.9, "image/jpeg", 3 * MiB)).rejects.toMatchObject({ reason: "canvas" });
  });
});
