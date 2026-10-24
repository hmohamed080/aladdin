import { describe, expect, it } from "vitest";
import { detectImageType, matchesDeclaredType } from "./image-signature";

const bytes = (...v: number[]) => new Uint8Array(v);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

describe("image signatures", () => {
  it("recognizes PNG, JPEG and WebP by content", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPG)).toBe("image/jpeg");
    expect(detectImageType(WEBP)).toBe("image/webp");
  });

  it("rejects everything else, including common disguises", () => {
    expect(detectImageType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<?php system($_GET['c']); ?>"))).toBeNull();
    expect(detectImageType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull(); // %PDF-
    expect(detectImageType(bytes(0x4d, 0x5a))).toBeNull(); // PE executable
    expect(detectImageType(new Uint8Array())).toBeNull();
    // RIFF container that is not WebP (e.g. WAV / AVI)
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    // truncated signatures
    expect(detectImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("matches only the declared type (a PNG labelled JPEG is a mismatch)", () => {
    expect(matchesDeclaredType(PNG, "image/png")).toBe(true);
    expect(matchesDeclaredType(PNG, "image/jpeg")).toBe(false);
    expect(matchesDeclaredType(JPG, "image/webp")).toBe(false);
    expect(matchesDeclaredType(WEBP, null)).toBe(false);
    expect(matchesDeclaredType(WEBP, undefined)).toBe(false);
  });
});
