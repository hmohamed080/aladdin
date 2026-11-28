import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/market" }));
import { catalogHref, type CatalogParams } from "./live-catalog";

const base: CatalogParams = { category: "", type: "", q: "", sort: "newest", page: 1, priceMin: null, priceMax: null, freeShipping: false, maxDays: null, place: null, attrs: {} };

describe("catalogHref", () => {
  it("is the bare route with no filters", () => {
    expect(catalogHref(base)).toBe("/market");
  });

  it("serialises every filter and drops empty attribute lists", () => {
    const href = catalogHref(base, {
      type: "wallpaper",
      category: "wall_coverings_panels",
      q: "suzuki",
      sort: "price_asc",
      priceMin: 100,
      priceMax: 900,
      freeShipping: true,
      maxDays: 3,
      place: { gov: "cairo", area: "nasr-city" },
      attrs: { color: ["pink", "green"], pattern_wallpaper: [] },
    });
    const sp = new URL(href, "http://x").searchParams;
    expect(Object.fromEntries(sp)).toEqual({
      category: "wall_coverings_panels",
      type: "wallpaper",
      q: "suzuki",
      sort: "price_asc",
      pmin: "100",
      pmax: "900",
      free: "1",
      days: "3",
      gov: "cairo",
      area: "nasr-city",
      "f.color": "pink,green",
    });
  });

  it("any filter change goes back to page 1, an explicit page is kept", () => {
    expect(catalogHref({ ...base, page: 4 }, { freeShipping: true })).toBe("/market?free=1");
    expect(catalogHref({ ...base, page: 4 }, { page: 5 })).toBe("/market?page=5");
  });
});
