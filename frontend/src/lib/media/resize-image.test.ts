import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCanvas, resizeImageForUpload, UPLOAD_RESIZE_PROFILES } from "./resize-image";

/**
 * A canvas double. It records every draw and returns a blob whose size is set
 * by the test, and whose type mimics a browser: one that cannot encode WebP
 * hands back PNG instead (which is what Safari's `toBlob` historically did).
 */
type Encoder = (type: string, quality: number, canvas: FakeCanvas) => { type: string; size: number } | null;
type FakeCanvas = { width: number; height: number; draws: Array<[number, number]>; getContext: () => unknown; toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => void };

let canvases: FakeCanvas[];
let encoder: Encoder;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
const createImageBitmap = vi.fn(async () => bitmap);

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0, height: 0, draws: [],
    getContext: () => ({ imageSmoothingEnabled: false, imageSmoothingQuality: "low",
      drawImage: (_s: unknown, _x: number, _y: number, w: number, h: number) => canvas.draws.push([w, h]) }),
    toBlob: (cb, type, q) => {
      const out = encoder(type, q, canvas);
      cb(out ? new Blob([new Uint8Array(out.size)], { type: out.type }) : null);
    },
  };
  canvases.push(canvas);
  return canvas;
}

const file = (size: number, type = "image/jpeg", name = "IMG_0001.JPG") =>
  new File([new Uint8Array(size)], name, { type, lastModified: 42 });

beforeEach(() => {
  canvases = [];
  bitmap = { width: 4032, height: 3024, close: vi.fn() };
  encoder = (type) => ({ type, size: 600_000 });
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : null) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("resizeImageForUpload", () => {
  it("caps the long edge at 2560 px, applies EXIF orientation and re-encodes to WebP", async () => {
    const out = await resizeImageForUpload(file(4_000_000), UPLOAD_RESIZE_PROFILES.portfolio);
    // eslint-disable-next-line no-restricted-syntax -- a createImageBitmap option, not a Tailwind class
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    const final = canvases.at(-1)!;
    expect([final.width, final.height]).toEqual([2560, 1920]);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("IMG_0001.webp");
    expect(out.size).toBe(600_000);
    expect(out.lastModified).toBe(42);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("encodes WebP at the profile quality", async () => {
    const qualities: number[] = [];
    encoder = (type, q) => { qualities.push(q); return { type, size: 10 }; };
    await resizeImageForUpload(file(4_000_000), UPLOAD_RESIZE_PROFILES.portfolio);
    expect(qualities).toEqual([0.85]);
  });

  it("downsamples in halving steps for large reductions", async () => {
    bitmap = { width: 8000, height: 6000, close: vi.fn() };
    await resizeImageForUpload(file(4_900_000), UPLOAD_RESIZE_PROFILES.portfolio);
    expect(canvases.map((c) => [c.width, c.height])).toEqual([[4000, 3000], [2560, 1920]]);
  });

  it("leaves sources beyond the decode budget for the server to judge", async () => {
    bitmap = { width: 12000, height: 9000, close: vi.fn() };
    const huge = file(4_900_000);
    expect(await resizeImageForUpload(huge, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(huge);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("never upscales, and keeps an already-small, in-bounds original untouched", async () => {
    bitmap = { width: 1200, height: 900, close: vi.fn() };
    const small = file(300_000);
    expect(await resizeImageForUpload(small, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(small);
    expect(canvases).toHaveLength(0);
    const heavy = await resizeImageForUpload(file(2_000_000, "image/png", "scan.png"), UPLOAD_RESIZE_PROFILES.portfolio);
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual([1200, 900]);
    expect(heavy.type).toBe("image/webp");
  });

  it("falls back to the original when the result is not smaller", async () => {
    encoder = (type) => ({ type, size: 5_000_000 });
    const original = file(4_000_000);
    expect(await resizeImageForUpload(original, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(original);
  });

  it("falls back to JPEG for opaque sources and PNG for alpha-capable ones when WebP is unsupported", async () => {
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 500_000 });
    expect((await resizeImageForUpload(file(4_000_000), UPLOAD_RESIZE_PROFILES.product)).type).toBe("image/jpeg");
    const logo = await resizeImageForUpload(file(4_000_000, "image/png", "logo.png"), UPLOAD_RESIZE_PROFILES.product);
    expect(logo.type).toBe("image/png");
    expect(logo.name).toBe("logo.png");
  });

  it("leaves PDFs, unsupported types and undecodable files untouched", async () => {
    const pdf = file(2_000_000, "application/pdf", "cert.pdf");
    expect(await resizeImageForUpload(pdf, UPLOAD_RESIZE_PROFILES.certificate)).toBe(pdf);
    const gif = file(2_000_000, "image/gif", "a.gif");
    expect(await resizeImageForUpload(gif, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(gif);
    expect(createImageBitmap).not.toHaveBeenCalled();
    createImageBitmap.mockRejectedValueOnce(new Error("decode failed"));
    const broken = file(4_000_000);
    expect(await resizeImageForUpload(broken, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(broken);
  });

  it("uploads the original when the browser lacks createImageBitmap or an encoder", async () => {
    const original = file(4_000_000);
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await resizeImageForUpload(original, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(original);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    encoder = () => null;
    expect(await resizeImageForUpload(original, UPLOAD_RESIZE_PROFILES.portfolio)).toBe(original);
  });

  it("keeps certificates legible: a higher cap and quality", async () => {
    bitmap = { width: 6000, height: 4000, close: vi.fn() };
    const qualities: number[] = [];
    encoder = (type, q) => { qualities.push(q); return { type, size: 900_000 }; };
    await resizeImageForUpload(file(8_000_000), UPLOAD_RESIZE_PROFILES.certificate);
    expect([canvases.at(-1)!.width, canvases.at(-1)!.height]).toEqual([3200, 2133]);
    expect(qualities).toEqual([0.9]);
  });
});

describe("encodeCanvas", () => {
  it("checks the produced type instead of trusting the request", async () => {
    encoder = (type) => ({ type: type === "image/webp" ? "image/png" : type, size: 1 });
    const blob = await encodeCanvas(fakeCanvas() as unknown as HTMLCanvasElement, 0.85, "image/jpeg");
    expect(blob.type).toBe("image/jpeg");
  });
});
