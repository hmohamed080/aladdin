import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  isProductImageKey,
  moveImage,
  remainingImageSlots,
  validateProductImageFile,
} from "./product-images";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const PRODUCT = "46d3bc5b-16a1-4aa0-966e-274673264654";
const IMAGE = "5bc41c1a-0000-4000-8000-000000000001";

describe("product image files", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s up to the bucket limit", (type) => {
    expect(validateProductImageFile({ type, size: 1024 })).toEqual({ ok: true });
    expect(validateProductImageFile({ type, size: PRODUCT_IMAGE_MAX_BYTES })).toEqual({ ok: true });
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain", ""])("refuses %j", (type) => {
    expect(validateProductImageFile({ type, size: 1024 })).toEqual({ ok: false, code: "showroomProducts.images.errorType" });
  });

  it("refuses empty files, never large originals", () => {
    expect(validateProductImageFile({ type: "image/png", size: 0 })).toEqual({ ok: false, code: "showroomProducts.images.errorSize" });
    // The picked original is never refused for its size; the prepared upload is fitted under the ceiling.
    expect(validateProductImageFile({ type: "image/png", size: PRODUCT_IMAGE_MAX_BYTES * 16 })).toEqual({ ok: true });
  });
});

describe("product image keys", () => {
  it("accepts the organization/product/image shape the database mints", () => {
    expect(isProductImageKey(`${ORG}/${PRODUCT}/${IMAGE}.png`)).toBe(true);
    expect(isProductImageKey(`${ORG}/${PRODUCT}/${IMAGE}.webp`)).toBe(true);
  });

  it.each([
    "../etc/passwd",
    `${ORG}/${PRODUCT}/${IMAGE}.gif`,
    `${ORG}/${PRODUCT}.png`,
    `${PRODUCT}/${IMAGE}.png`,
    `${ORG}/${PRODUCT}/${IMAGE}.png/extra`,
    `${ORG}/../${PRODUCT}/${IMAGE}.png`,
    "",
  ])("refuses %j", (key) => {
    expect(isProductImageKey(key)).toBe(false);
  });

  it("refuses non-strings", () => {
    expect(isProductImageKey(null)).toBe(false);
    expect(isProductImageKey(42)).toBe(false);
  });
});

describe("the three-photo rule as the UI applies it", () => {
  it("counts the free slots, never below zero", () => {
    expect(remainingImageSlots(0)).toBe(3);
    expect(remainingImageSlots(2)).toBe(1);
    expect(remainingImageSlots(3)).toBe(0);
    expect(remainingImageSlots(9)).toBe(0);
  });

  it("moves a photo one step and stops at the ends", () => {
    expect(moveImage(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveImage(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveImage(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveImage(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveImage(["a"], 5, 1)).toEqual(["a"]);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b"];
    moveImage(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });
});
