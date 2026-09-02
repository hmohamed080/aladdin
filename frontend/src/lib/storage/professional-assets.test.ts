import { describe, expect, it } from "vitest";
import {
  ASSET_NAMESPACES,
  ASSET_POLICY,
  ASSET_READ_URL_SECONDS,
  buildAssetKey,
  bytesMatchType,
  isAssetKeyOwnedBy,
  validateAssetContent,
  validateAssetFile,
} from "./professional-assets";

const OWNER = "70000009-0000-4000-8000-000000000009";
const OTHER = "71000006-0000-4000-8000-000000000006";
const OBJECT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/**
 * These assertions have a twin. `app.is_professional_asset_key` runs the same
 * attack table in `supabase/tests/47_professional_asset_storage_test.sql`, and it
 * is the one with authority — this module never decides anything, it only lets a
 * browser answer quickly. The two are kept identical deliberately: a divergence
 * would show up as a file that passes here and is refused by the policy, which
 * is the confusing failure rather than the dangerous one.
 */
describe("the object key contract", () => {
  it("builds `<owner>/<object-id>.<ext>` with the extension taken from the TYPE", () => {
    expect(buildAssetKey(OWNER, OBJECT, "image/jpeg")).toBe(`${OWNER}/${OBJECT}.jpg`);
    expect(buildAssetKey(OWNER, OBJECT, "application/pdf")).toBe(`${OWNER}/${OBJECT}.pdf`);
  });

  it("refuses to build a key for a type it has no extension for", () => {
    expect(() => buildAssetKey(OWNER, OBJECT, "image/svg+xml")).toThrow();
  });

  it("accepts a well-formed key belonging to the caller", () => {
    expect(isAssetKeyOwnedBy(`${OWNER}/${OBJECT}.jpg`, OWNER)).toBe(true);
    expect(isAssetKeyOwnedBy(`${OWNER}/${OBJECT}.pdf`, OWNER)).toBe(true);
  });

  it.each([
    ["another user's folder", `${OTHER}/${OBJECT}.jpg`],
    ["a traversal", `${OWNER}/../${OTHER}/${OBJECT}.jpg`],
    ["a bare parent segment", `${OWNER}/..`],
    ["percent-encoded traversal", `${OWNER}/%2e%2e/${OTHER}/x.jpg`],
    ["an empty name", ""],
    ["the folder itself", OWNER],
    ["an extra namespace segment", `${OWNER}/portfolio/${OBJECT}.jpg`],
    ["a display filename", `${OWNER}/${OBJECT}/site-photo.jpg`],
    ["an unsupported extension", `${OWNER}/${OBJECT}.svg`],
    ["a double extension", `${OWNER}/${OBJECT}.jpg.html`],
    ["uppercase hex", `${OWNER}/${OBJECT.toUpperCase()}.jpg`],
    ["a prefix of the owner id", `${OWNER}9/${OBJECT}.jpg`],
    ["a smuggled second line", `${OWNER}/${OBJECT}.jpg\n${OTHER}/${OBJECT}.jpg`],
  ])("refuses %s", (_label, key) => {
    expect(isAssetKeyOwnedBy(key, OWNER)).toBe(false);
  });

  it("refuses everything when there is no owner — an unauthenticated caller has no folder", () => {
    expect(isAssetKeyOwnedBy(`${OWNER}/${OBJECT}.jpg`, "")).toBe(false);
  });
});

describe("the namespace policy", () => {
  it("gives each namespace its own bucket, because the limits differ", () => {
    expect(ASSET_POLICY.portfolio.bucket).not.toBe(ASSET_POLICY.certificate.bucket);
    expect(ASSET_POLICY.portfolio.maxBytes).not.toBe(ASSET_POLICY.certificate.maxBytes);
  });

  /**
   * Locked to the exact numbers the migration writes into `storage.buckets`. If
   * one side moves, this fails — which is the only way a limit that lives in two
   * places stays one limit.
   */
  it("matches the bucket configuration exactly", () => {
    expect(ASSET_POLICY.portfolio).toEqual({
      bucket: "professional-portfolio",
      types: ["image/jpeg", "image/png", "image/webp"],
      maxBytes: 5242880,
    });
    expect(ASSET_POLICY.certificate).toEqual({
      bucket: "professional-certificates",
      types: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      maxBytes: 10485760,
    });
  });

  it("accepts a PDF as a certificate and refuses one as a portfolio piece", () => {
    const pdf = { type: "application/pdf", size: 1000 };
    expect(validateAssetFile("certificate", pdf).ok).toBe(true);
    expect(validateAssetFile("portfolio", pdf)).toEqual({
      ok: false,
      code: "assets.errors.unsupportedType",
    });
  });

  it("admits no SVG anywhere — an unsanitized scriptable document is not an image", () => {
    for (const ns of ASSET_NAMESPACES) {
      expect(ASSET_POLICY[ns].types).not.toContain("image/svg+xml");
      expect(validateAssetFile(ns, { type: "image/svg+xml", size: 10 }).ok).toBe(false);
    }
  });

  it("admits no video, because nothing in this product could play one", () => {
    for (const ns of ASSET_NAMESPACES) {
      expect(ASSET_POLICY[ns].types.some((t) => t.startsWith("video/"))).toBe(false);
    }
  });

  it("refuses an oversized file and an empty one with different reasons", () => {
    expect(validateAssetFile("portfolio", { type: "image/png", size: 5242881 })).toEqual({
      ok: false,
      code: "assets.errors.tooLarge",
    });
    expect(validateAssetFile("portfolio", { type: "image/png", size: 0 })).toEqual({
      ok: false,
      code: "assets.errors.empty",
    });
  });

  it("accepts a file exactly at the limit — the boundary is inclusive", () => {
    expect(validateAssetFile("portfolio", { type: "image/png", size: 5242880 }).ok).toBe(true);
  });
});

/**
 * The signature check is a correctness net, not a boundary, and the tests say so:
 * they prove it catches a mislabelled file, and nothing here claims it stops a
 * caller who declines to run it.
 */
describe("declared type versus actual bytes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("recognises each accepted format", () => {
    expect(bytesMatchType(png, "image/png")).toBe(true);
    expect(bytesMatchType(jpeg, "image/jpeg")).toBe(true);
    expect(bytesMatchType(pdf, "application/pdf")).toBe(true);
    expect(bytesMatchType(webp, "image/webp")).toBe(true);
  });

  it("catches a script declared as a PNG, which the bucket's type list cannot", () => {
    const script = new TextEncoder().encode("<?php system($_GET['c']); ?>");
    expect(bytesMatchType(script, "image/png")).toBe(false);
    expect(validateAssetContent("portfolio", { type: "image/png", size: 28 }, script)).toEqual({
      ok: false,
      code: "assets.errors.contentMismatch",
    });
  });

  it("catches an HTML document declared as a PDF", () => {
    const html = new TextEncoder().encode("<!doctype html><script>x()</script>");
    expect(validateAssetContent("certificate", { type: "application/pdf", size: 35 }, html)).toEqual(
      { ok: false, code: "assets.errors.contentMismatch" },
    );
  });

  it("catches a PDF renamed to look like a portfolio image", () => {
    expect(bytesMatchType(pdf, "image/png")).toBe(false);
  });

  it("rejects a RIFF container that is not WebP", () => {
    const avi = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
    expect(bytesMatchType(avi, "image/webp")).toBe(false);
  });

  it("checks the cheap things first, so a huge file fails on size not on bytes", () => {
    expect(
      validateAssetContent("portfolio", { type: "image/png", size: 99_000_000 }, png),
    ).toEqual({ ok: false, code: "assets.errors.tooLarge" });
  });

  it("knows no signature for a type it does not accept", () => {
    expect(bytesMatchType(png, "image/svg+xml")).toBe(false);
  });
});

describe("read URL lifetime", () => {
  it("is short, and short enough that a copied URL is not a lasting handout", () => {
    expect(ASSET_READ_URL_SECONDS).toBe(300);
    expect(ASSET_READ_URL_SECONDS).toBeLessThanOrEqual(600);
  });
});
