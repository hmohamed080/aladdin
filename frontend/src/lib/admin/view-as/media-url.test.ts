import { describe, expect, it } from "vitest";
import { viewMediaUrl, viewMediaUrlFor, viewVideoPoster, viewVideoSrc } from "./media-url";

const U = "71000006-0000-4000-8000-000000000006";
const M = "c1000000-0000-4000-8000-000000000001";

describe("view media URL seam", () => {
  it("builds the exact-parity tree and the legacy tree from the same reference", () => {
    expect(viewMediaUrl("exact", U, "avatar", M)).toBe(`/view-as/${U}/media/avatar/${M}`);
    expect(viewMediaUrl("legacy", U, "certificate", M)).toBe(`/admin/users/${U}/view/media/certificate/${M}`);
    expect(viewVideoSrc("exact", U, M)).toBe(`/view-as/${U}/media/video/${M}/master.m3u8`);
    expect(viewVideoPoster("legacy", U, M)).toBe(`/admin/users/${U}/view/media/video/${M}/poster.jpg`);
  });
  it("maps an owner media reference by namespace", () => {
    expect(viewMediaUrlFor("exact", U, { namespace: "portfolio", id: M })).toBe(`/view-as/${U}/media/portfolio/${M}`);
    expect(viewMediaUrlFor("exact", U, { namespace: "video", id: M })).toBe(`/view-as/${U}/media/video/${M}/master.m3u8`);
  });
  it("refuses anything that is not an opaque id (no key, path or URL can be smuggled in)", () => {
    expect(() => viewMediaUrl("exact", U, "avatar", "u/abc/original.jpg")).toThrow();
    expect(() => viewMediaUrl("exact", "../x", "avatar", M)).toThrow();
    expect(() => viewVideoSrc("legacy", U, "https://r2.example/x?X-Amz-Signature=1")).toThrow();
  });
});
