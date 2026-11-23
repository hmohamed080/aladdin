import { describe, expect, it } from "vitest";
import { marketplaceImageSrc, marketplaceImageSrcSet } from "./marketplace-images";

const ID = "11111111-1111-4111-8111-111111111111";

describe("marketplace image URLs", () => {
  it("builds a srcset only from sizes the Worker recorded", () => {
    expect(marketplaceImageSrcSet({ [ID]: { src: "/o", thumb: "/t", card: "/c" } }, ID)).toBe("/t 320w, /c 768w");
    expect(marketplaceImageSrcSet({ [ID]: { src: "/o", card: "/c" } }, ID)).toBeUndefined();
    expect(marketplaceImageSrcSet(undefined, ID)).toBeUndefined();
  });

  it("falls back to the original, then to the application route, never to a private key", () => {
    expect(marketplaceImageSrc({ [ID]: { src: "/o" } }, ID, "card")).toBe("/o");
    expect(marketplaceImageSrc(undefined, ID, "card")).toBe(`/market/media/${ID}?v=card`);
  });
});
