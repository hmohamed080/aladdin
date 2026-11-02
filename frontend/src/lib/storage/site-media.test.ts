import { describe, expect, it } from "vitest";
import { isAccountMediaKey, isSiteMediaKey, siteMediaKey } from "./site-media";

const id = "0b8f6f7e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

describe("site media keys", () => {
  it("builds shared and per-page keys from ids only", () => {
    expect(siteMediaKey({ kind: "shared" }, id, "webp")).toBe(`site/shared/${id}/original.webp`);
    expect(siteMediaKey({ kind: "page", feature: "landing" }, id, "mp4")).toBe(`site/pages/landing/${id}/original.mp4`);
  });
  it("rejects file names, traversal and unknown extensions", () => {
    expect(() => siteMediaKey({ kind: "shared" }, "../x", "webp")).toThrow();
    expect(() => siteMediaKey({ kind: "page", feature: "../admin" }, id, "webp")).toThrow();
    expect(() => siteMediaKey({ kind: "shared" }, id, "svg")).toThrow();
  });
  it("keeps site media and account media in disjoint key spaces", () => {
    const site = siteMediaKey({ kind: "shared" }, id, "png");
    expect(isSiteMediaKey(site)).toBe(true);
    expect(isAccountMediaKey(site)).toBe(false);
    const account = `u/${id}/profile/${id}/original.webp`;
    expect(isAccountMediaKey(account)).toBe(true);
    expect(isSiteMediaKey(account)).toBe(false);
  });
});
