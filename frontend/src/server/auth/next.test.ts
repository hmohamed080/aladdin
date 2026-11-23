import { describe, expect, it } from "vitest";
import { isMarketplaceReturn, postAuthDestination, sanitizeNext } from "./next";

const ORDER = "/market/orders/1cbc7227-7c69-4a56-a4ab-9da5d005d837";

describe("Marketplace return after sign-in", () => {
  it("keeps the checkout and the buyer's orders as the post-sign-in destination", () => {
    for (const path of ["/market/checkout", "/market/checkout?method=delivery&gov=cairo", "/market/orders", ORDER]) {
      expect(isMarketplaceReturn(path)).toBe(true);
      expect(sanitizeNext(path)).toBe(path);
      expect(postAuthDestination(path, "/home")).toBe(path);
      expect(postAuthDestination(path, "/showroom/home")).toBe(path);
    }
  });

  it("does not open any other Marketplace or look-alike path", () => {
    for (const path of ["/market", "/market/cart", "/market/checkoutx", "/market/orders/not-a-uuid",
      "/market/orders/../admin", "/market/checkout?next=//evil.example", "//market/checkout", "https://x.test/market/checkout"]) {
      expect(isMarketplaceReturn(path)).toBe(false);
      expect(sanitizeNext(path)).toBe("/b2b");
    }
  });

  it("leaves the workspace rule unchanged: a deep link survives only inside the caller's landing surface", () => {
    expect(postAuthDestination("/home/jobs", "/home")).toBe("/home/jobs");
    expect(postAuthDestination("/b2b/leads", "/home")).toBe("/home");
    expect(postAuthDestination("/b2b", "/b2b")).toBe("/b2b");
  });
});
