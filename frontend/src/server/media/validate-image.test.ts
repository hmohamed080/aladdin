import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
import { validateImageBytes } from "./validate-image";

async function png(w = 20, h = 10) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 185, g: 111, b: 82 } } }).png().toBuffer();
}

describe("validateImageBytes", () => {
  it("accepts a real PNG and reports its facts", async () => {
    const r = await validateImageBytes(await png());
    expect(r).toMatchObject({ valid: true, format: "png", width: 20, height: 10 });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts JPEG and WebP", async () => {
    const base = await png();
    expect((await validateImageBytes(await sharp(base).jpeg().toBuffer())).valid).toBe(true);
    expect((await validateImageBytes(await sharp(base).webp().toBuffer())).valid).toBe(true);
  });

  it("rejects bytes that are not an image whatever the file claims", async () => {
    expect(await validateImageBytes(Buffer.from("<html>not an image</html>"))).toMatchObject({ valid: false, reason: "unknown_signature" });
  });

  it("rejects a truncated image that only LOOKS like a PNG", async () => {
    const full = await png(200, 200);
    expect(await validateImageBytes(full.subarray(0, 60))).toMatchObject({ valid: false });
  });
});
