import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { checkImageContainer } from "./container-check";

const solid = (format: "jpeg" | "png" | "webp") =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "teal" } }).toFormat(format).toBuffer();

describe("image container check", () => {
  it.each(["jpeg", "png", "webp"] as const)("accepts a complete %s and refuses it cut short or mislabelled", async (format) => {
    const bytes = new Uint8Array(await solid(format));
    expect(() => checkImageContainer(bytes, `image/${format}`)).not.toThrow();
    expect(() => checkImageContainer(bytes.subarray(0, bytes.length - 3), `image/${format}`)).toThrow();
    expect(() => checkImageContainer(bytes, format === "png" ? "image/jpeg" : "image/png")).toThrow();
  });

  it("refuses a PNG with a corrupted chunk (CRC) and an APNG", async () => {
    const png = new Uint8Array(await solid("png"));
    const corrupt = png.slice();
    corrupt[40] = corrupt[40]! ^ 0xff; // inside IDAT data
    expect(() => checkImageContainer(corrupt, "image/png")).toThrow();
    const acTL = [0, 0, 0, 8, ...[..."acTL"].map((c) => c.charCodeAt(0)), 0, 0, 0, 2, 0, 0, 0, 0];
    const crc = crc32(new Uint8Array(acTL.slice(4)));
    const apng = new Uint8Array([...png.subarray(0, 33), ...acTL, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255, ...png.subarray(33)]);
    expect(() => checkImageContainer(apng, "image/png")).toThrow();
  });

  it("accepts data after the JPEG end marker (multi-picture files) but not an unterminated scan", async () => {
    const jpeg = new Uint8Array(await solid("jpeg"));
    expect(() => checkImageContainer(new Uint8Array([...jpeg, 1, 2, 3]), "image/jpeg")).not.toThrow();
    expect(() => checkImageContainer(jpeg.subarray(0, jpeg.length - 2), "image/jpeg")).toThrow();
  });
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
