import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES } from "@/lib/storage/avatar-assets";
import { ORGANIZATION_IMAGE_MAX_BYTES } from "@/lib/storage/organization-image-assets";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/storage/product-images";
import { REQUEST_IMAGE_MAX_BYTES } from "@/lib/storage/request-images";
import { MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { ASSET_POLICY } from "@/lib/storage/professional-assets";
import { BV_MAX_BYTES } from "@/lib/business-verification/contract";
import { VIDEO_STORAGE_MAX_BYTES } from "@/lib/media/video-policy";
import { MIB } from "@/lib/media/upload-limits";
import {
  DEFAULT_IMAGE_LIMITS, DEFAULT_VIDEO_LIMITS, IMAGE_PLACES, MEDIA_LIMIT_CEILING, MEDIA_LIMIT_FLOOR, VIDEO_PLACES,
  defaultLimit, formatLimit, parseLimitRows, resolveLimit, validateLimitInput, type MediaLimitRow,
} from "./limits";

const row = (kind: "image" | "video", place: string, maxBytes: number): MediaLimitRow =>
  ({ kind, place, maxBytes, defaultBytes: maxBytes, ceilingBytes: MEDIA_LIMIT_CEILING[kind], updatedAt: null });

describe("media limit defaults", () => {
  it("equal the compiled caps of every place, so a fallback never changes behaviour", () => {
    expect(DEFAULT_IMAGE_LIMITS).toEqual({
      avatar: AVATAR_MAX_BYTES,
      organization: ORGANIZATION_IMAGE_MAX_BYTES,
      portfolio: ASSET_POLICY.portfolio.maxBytes,
      certificate: ASSET_POLICY.certificate.maxBytes,
      product: PRODUCT_IMAGE_MAX_BYTES,
      request: REQUEST_IMAGE_MAX_BYTES,
      verification: BV_MAX_BYTES,
      marketplace: MARKETPLACE_IMAGE_MAX_BYTES,
    });
    expect(DEFAULT_VIDEO_LIMITS).toEqual({ portfolio: VIDEO_STORAGE_MAX_BYTES, product: VIDEO_STORAGE_MAX_BYTES });
  });

  it("match the seeded database rows (migration 20261121090002)", () => {
    // 3 MiB: avatar, organization; 10 MiB: the other six image places; 100 MiB: both video places
    expect(IMAGE_PLACES.map((p) => DEFAULT_IMAGE_LIMITS[p] / MIB).sort()).toEqual([10, 10, 10, 10, 10, 10, 3, 3].sort());
    expect(VIDEO_PLACES.map((p) => DEFAULT_VIDEO_LIMITS[p] / MIB)).toEqual([100, 100]);
  });

  it("keep every default inside the hard ceiling and above the floor", () => {
    for (const p of IMAGE_PLACES) expect(DEFAULT_IMAGE_LIMITS[p]).toBeLessThanOrEqual(MEDIA_LIMIT_CEILING.image);
    for (const p of VIDEO_PLACES) expect(DEFAULT_VIDEO_LIMITS[p]).toBeLessThanOrEqual(MEDIA_LIMIT_CEILING.video);
    expect(MEDIA_LIMIT_CEILING).toEqual({ image: 20 * MIB, video: 1024 * MIB });
    expect(MEDIA_LIMIT_FLOOR).toEqual({ image: 100 * 1024, video: MIB });
  });
});

describe("resolveLimit", () => {
  it("uses the stored value, falls back to the default, and never leaves the ceiling or the floor", () => {
    expect(resolveLimit(null, "image", "marketplace")).toBe(10 * MIB);
    expect(resolveLimit([row("image", "marketplace", 20 * MIB)], "image", "marketplace")).toBe(20 * MIB);
    expect(resolveLimit([row("image", "marketplace", 20 * MIB)], "image", "avatar")).toBe(3 * MIB); // other place: default
    expect(resolveLimit([row("image", "marketplace", 500 * MIB)], "image", "marketplace")).toBe(20 * MIB); // tampered row: clamped
    expect(resolveLimit([row("video", "product", 10)], "video", "product")).toBe(MIB); // below floor: clamped
    expect(resolveLimit([row("video", "product", Number.NaN)], "video", "product")).toBe(100 * MIB); // junk: default
  });
});

describe("validateLimitInput", () => {
  it("accepts the ceiling and the floor, refuses one byte beyond either, and unknown places", () => {
    expect(validateLimitInput("image", "marketplace", 20 * MIB)).toEqual({ ok: true });
    expect(validateLimitInput("image", "marketplace", 20 * MIB + 1)).toEqual({ ok: false, code: "above_ceiling" });
    expect(validateLimitInput("image", "marketplace", 100 * 1024 - 1)).toEqual({ ok: false, code: "below_floor" });
    expect(validateLimitInput("video", "product", 1024 * MIB)).toEqual({ ok: true });
    expect(validateLimitInput("video", "product", 1024 * MIB + 1)).toEqual({ ok: false, code: "above_ceiling" });
    expect(validateLimitInput("video", "avatar", MIB)).toEqual({ ok: false, code: "unknown_place" });
    expect(validateLimitInput("image", "marketplace", 1.5)).toEqual({ ok: false, code: "not_a_number" });
  });

  it("knows the places exactly: an image place is not a video place", () => {
    expect(defaultLimit("image", "portfolio")).toBe(10 * MIB);
    expect(defaultLimit("video", "marketplace")).toBeNull();
    expect(defaultLimit("image", "nope")).toBeNull();
  });
});

describe("parseLimitRows", () => {
  it("reads the RPC rows and drops anything malformed", () => {
    const rows = parseLimitRows([
      { kind: "image", place: "marketplace", max_bytes: 15728640, default_bytes: 10485760, ceiling_bytes: 20971520, updated_at: "2026-11-21T10:00:00Z" },
      { kind: "audio", place: "x", max_bytes: 1, default_bytes: 1, ceiling_bytes: 1 },
      { kind: "video", place: "product", max_bytes: "not a number", default_bytes: 1, ceiling_bytes: 1 },
      null,
    ]);
    expect(rows).toEqual([{ kind: "image", place: "marketplace", maxBytes: 15728640, defaultBytes: 10485760, ceilingBytes: 20971520, updatedAt: "2026-11-21T10:00:00Z" }]);
    expect(parseLimitRows({})).toEqual([]);
  });
});

describe("formatLimit", () => {
  it("prints whole MB, one decimal, KB and GB", () => {
    expect(formatLimit(10 * MIB)).toBe("10 MB");
    expect(formatLimit(Math.round(12.5 * MIB))).toBe("12.5 MB");
    expect(formatLimit(100 * 1024)).toBe("100 KB");
    expect(formatLimit(1024 * MIB)).toBe("1 GB");
  });
});
