import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/marketplace" }));
import { catalogHref, type CatalogParams } from "./live-catalog";

const base: CatalogParams = { category: "", type: "", q: "", sort: "newest", page: 1, priceMin: null, priceMax: null, inStock: false, attrs: {} };

describe("catalogHref", () => {
  it("is the bare route with no filters", () => {
    expect(catalogHref(base)).toBe("/marketplace");
  });

  it("serialises every filter and drops empty attribute lists", () => {
    const href = catalogHref(base, {
      type: "wallpaper",
      category: "wall_coverings_panels",
      q: "suzuki",
      sort: "price_asc",
      priceMin: 100,
      priceMax: 900,
      inStock: true,
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
      stock: "1",
      "f.color": "pink,green",
    });
  });

  it("any filter change goes back to page 1, an explicit page is kept", () => {
    expect(catalogHref({ ...base, page: 4 }, { inStock: true })).toBe("/marketplace?stock=1");
    expect(catalogHref({ ...base, page: 4 }, { page: 5 })).toBe("/marketplace?page=5");
  });
});
