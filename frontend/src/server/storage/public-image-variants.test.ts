import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { generateImageVariants, generatePublicImageVariants, variantManifest, VARIANT_MAX_BYTES } from "./public-image-variants";
import { withMediaProcessingSlot } from "./validation";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "white" } });

describe("server image variants", () => {
  it("produces thumb/card/full WebP at 320/768/1600 without upscaling", async () => {
    const bytes = await solid(2400, 1200).jpeg().toBuffer();
    const variants = await generateImageVariants(bytes);
    expect(variants.map((v) => [v.variant, v.width, v.height])).toEqual([
      ["thumb", 320, 160], ["card", 768, 384], ["full", 1600, 800],
    ]);
    const small = await generateImageVariants(await solid(500, 400).png().toBuffer());
    expect(small.map((v) => v.width)).toEqual([320, 500, 500]);
    for (const v of variants) {
      const meta = await sharp(v.bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(v.width);
      expect(v.size).toBe(v.bytes.byteLength);
      expect(v.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("applies EXIF orientation, then strips EXIF/ICC metadata", async () => {
    // 600x300 landscape pixels tagged "rotate 90 deg CW" display as 300x600 portrait.
    const bytes = await solid(600, 300).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const [thumb] = await generateImageVariants(bytes);
    const meta = await sharp(thumb!.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([300, 600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("steps quality down so noisy photos stay near the variant budget", async () => {
    const noise = await sharp(randomBytes(1700 * 1100 * 3), { raw: { width: 1700, height: 1100, channels: 3 } }).png().toBuffer();
    const variants = await generateImageVariants(noise);
    const full = variants.find((v) => v.variant === "full")!;
    const atTopQuality = await sharp(noise).resize({ width: 1600 }).webp({ quality: 80, effort: 4 }).toBuffer();
    expect(atTopQuality.byteLength).toBeGreaterThan(VARIANT_MAX_BYTES);
    expect(full.size).toBeLessThan(atTopQuality.byteLength);
  });

  it("respects the per-instance processing slot instead of decoding beyond it", async () => {
    const bytes = await solid(64, 64).png().toBuffer();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const a = withMediaProcessingSlot(() => held);
    const b = withMediaProcessingSlot(() => held);
    await expect(generateImageVariants(bytes)).rejects.toThrow("busy");
    release();
    await Promise.all([a, b]);
    await expect(generateImageVariants(bytes)).resolves.toHaveLength(3);
  });

  it("verifies unverified public-pipeline bytes first and summarizes without bytes", async () => {
    await expect(generatePublicImageVariants(new TextEncoder().encode("<svg/>"), "image/png", 5242880)).rejects.toThrow();
    const variants = await generatePublicImageVariants(await solid(800, 400).png().toBuffer(), "image/png", 5242880);
    const manifest = variantManifest(variants);
    expect(Object.keys(manifest)).toEqual(["thumb", "card", "full"]);
    expect(manifest.card).toEqual({ width: 768, height: 384, size: expect.any(Number), sha256: expect.any(String) });
    expect(JSON.stringify(manifest)).not.toContain("bytes");
  });
});
