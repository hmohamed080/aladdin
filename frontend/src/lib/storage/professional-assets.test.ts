import { describe, expect, it } from "vitest";
import {
  ASSET_NAMESPACES,
  ASSET_POLICY,
  ASSET_READ_URL_SECONDS,
  bytesMatchType,
  isAssetKeyForCaller,
  isCertificatePathOwnedBy,
  isPortfolioObjectKey,
  validateAssetContent,
  validateAssetFile,
} from "./professional-assets";

const OWNER = "70000009-0000-4000-8000-000000000009";
const OTHER = "71000006-0000-4000-8000-000000000006";
const OBJECT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/**
 * TWO key contracts, because Increment 11 split them.
 *
 * These assertions have a twin in `48_portfolio_certificates_test.sql`, and the
 * SQL side is the one with authority: this module never decides anything, it only
 * lets a browser answer quickly. They are kept identical deliberately, so a
 * divergence shows up as a file that passes here and is refused by the policy —
 * the confusing failure rather than the dangerous one.
 */
describe("the certificate path contract", () => {
  it("accepts a well-formed path belonging to the caller", () => {
    expect(isCertificatePathOwnedBy(`${OWNER}/${OBJECT}.pdf`, OWNER)).toBe(true);
    expect(isCertificatePathOwnedBy(`${OWNER}/${OBJECT}.jpg`, OWNER)).toBe(true);
  });

  it.each([
    ["another user's folder", `${OTHER}/${OBJECT}.pdf`],
    ["a traversal", `${OWNER}/../${OTHER}/${OBJECT}.pdf`],
    ["a bare parent segment", `${OWNER}/..`],
    ["percent-encoded traversal", `${OWNER}/%2e%2e/${OTHER}/x.pdf`],
    ["an empty name", ""],
    ["the folder itself", OWNER],
    ["an extra namespace segment", `${OWNER}/certificates/${OBJECT}.pdf`],
    ["a display filename", `${OWNER}/${OBJECT}/scan.pdf`],
    ["an unsupported extension", `${OWNER}/${OBJECT}.svg`],
    ["a double extension", `${OWNER}/${OBJECT}.pdf.html`],
    ["uppercase hex", `${OWNER}/${OBJECT.toUpperCase()}.pdf`],
    ["a prefix of the owner id", `${OWNER}9/${OBJECT}.pdf`],
    ["a smuggled second line", `${OWNER}/${OBJECT}.pdf\n${OTHER}/${OBJECT}.pdf`],
  ])("refuses %s", (_label, key) => {
    expect(isCertificatePathOwnedBy(key, OWNER)).toBe(false);
  });

  it("refuses everything when there is no owner — an unauthenticated caller has no folder", () => {
    expect(isCertificatePathOwnedBy(`${OWNER}/${OBJECT}.pdf`, "")).toBe(false);
  });
});

/**
 * The portfolio key is opaque, and the assertions below are mostly about what it
 * CANNOT contain. A published photo has to be resolvable for a signed-out
 * visitor, and the Next server shares the browser's anon identity, so anything
 * the key carries is effectively published — which is why it carries nothing.
 */
describe("the portfolio key contract", () => {
  it("accepts one opaque uuid and an image extension", () => {
    expect(isPortfolioObjectKey(`${OBJECT}.jpg`)).toBe(true);
    expect(isPortfolioObjectKey(`${OBJECT}.png`)).toBe(true);
    expect(isPortfolioObjectKey(`${OBJECT}.webp`)).toBe(true);
  });

  it("refuses a PDF, because a portfolio piece is an image (S4)", () => {
    expect(isPortfolioObjectKey(`${OBJECT}.pdf`)).toBe(false);
  });

  it.each([
    ["an owner prefix — the Increment 10 shape", `${OWNER}/${OBJECT}.jpg`],
    ["any separator at all", `a/${OBJECT}.jpg`],
    ["a traversal", `../${OBJECT}.jpg`],
    ["an empty key", ""],
    ["a filename", "site-photo.jpg"],
    ["an unsupported extension", `${OBJECT}.svg`],
    ["a double extension", `${OBJECT}.jpg.html`],
    ["uppercase hex", `${OBJECT.toUpperCase()}.jpg`],
    ["a smuggled second line", `${OBJECT}.jpg\n${OBJECT}.jpg`],
  ])("refuses %s", (_label, key) => {
    expect(isPortfolioObjectKey(key)).toBe(false);
  });

  it("contains no owner id by construction, which is the point of the redesign", () => {
    const key = `${OBJECT}.jpg`;
    expect(isPortfolioObjectKey(key)).toBe(true);
    expect(key).not.toContain(OWNER);
    expect(key).not.toContain("/");
  });
});

/**
 * The asymmetry, stated once. A certificate path proves its own ownership; a
 * portfolio key deliberately cannot, so the pre-flight only checks its shape and
 * `app.owns_portfolio_object` answers ownership inside the storage policy.
 */
describe("isAssetKeyForCaller", () => {
  it("checks ownership for a certificate", () => {
    expect(isAssetKeyForCaller("certificate", `${OWNER}/${OBJECT}.pdf`, OWNER)).toBe(true);
    expect(isAssetKeyForCaller("certificate", `${OTHER}/${OBJECT}.pdf`, OWNER)).toBe(false);
  });

  it("checks only the SHAPE for portfolio, and says so by accepting any owner", () => {
    expect(isAssetKeyForCaller("portfolio", `${OBJECT}.jpg`, OWNER)).toBe(true);
    expect(isAssetKeyForCaller("portfolio", `${OBJECT}.jpg`, OTHER)).toBe(true);
    // Which is safe only because it is not the boundary: RLS refuses a key whose
    // metadata row belongs to somebody else, and that check cannot be skipped.
  });

  it("still refuses a malformed portfolio key outright", () => {
    expect(isAssetKeyForCaller("portfolio", `${OWNER}/${OBJECT}.jpg`, OWNER)).toBe(false);
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
