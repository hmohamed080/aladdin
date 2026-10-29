import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { MarketplaceBrowser } from "./marketplace-browser";
import { MarketplaceCartProvider } from "./marketplace-cart";
import { PAGE_SIZE, emptyFilters, listProducts, parseFilters, serializeFilters } from "./marketplace-filters";
import { MarketplaceProductDetail } from "./marketplace-product-detail";
import { findPreviewProduct, previewProducts } from "./marketplace-preview-data";
import { typeSchemas } from "./marketplace-schema";
import { TYPE_KEYS } from "./marketplace-types";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/marketplace",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const wrap = (node: ReactNode, locale: "ar" | "en" = "ar") => (
  <I18nProvider locale={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{node}</I18nProvider>
);

describe("schema and sample data", () => {
  it("has a schema for every approved product type, each with a required product-level field", () => {
    for (const type of TYPE_KEYS) {
      const fields = typeSchemas[type];
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.some((f) => f.required && f.scope === "product")).toBe(true);
    }
  });

  it("only allows filterable fields whose type supports correct filtering", () => {
    for (const type of TYPE_KEYS) {
      for (const f of typeSchemas[type].filter((x) => x.filterable)) {
        expect(["option", "boolean", "measurement", "color"]).toContain(f.valueType);
      }
    }
  });

  it("gives every sample product an image, a variant and values only for fields of its type", () => {
    for (const p of previewProducts) {
      expect(p.images.length).toBeGreaterThan(0);
      expect(p.variants.length).toBeGreaterThan(0);
      const keys = new Set(typeSchemas[p.type].map((f) => f.key));
      for (const k of Object.keys(p.values)) expect(keys.has(k)).toBe(true);
      for (const v of p.variants) for (const k of Object.keys(v.values)) expect(keys.has(k)).toBe(true);
    }
  });

  it("states the actual material for every sheeboard (never an implicit default)", () => {
    const sheeboard = previewProducts.filter((p) => p.type === "sheeboard");
    expect(sheeboard.length).toBeGreaterThan(0);
    for (const p of sheeboard) expect(typeof p.values.material).toBe("string");
  });
});

describe("filter semantics", () => {
  it("matches variant-level filters against ONE variant jointly", () => {
    // Walnut exists only at 8 mm; oak exists at 8 mm and 12 mm. Walnut AND 12 mm has no
    // single variant, so the product must not match — even though walnut and 12 mm both exist on it.
    const walnut12 = { ...emptyFilters(), type: "wood_alternative" as const, choices: { color: ["walnut"] }, ranges: { thickness_mm: { min: 12, max: 12 } } };
    expect(listProducts(previewProducts, walnut12, "en").map((l) => l.product.slug)).not.toContain("wall-wood-alternative");
    const oak12 = { ...walnut12, choices: { color: ["oak"] } };
    expect(listProducts(previewProducts, oak12, "en").map((l) => l.product.slug)).toContain("wall-wood-alternative");
  });

  it("uses OR within a group and AND across groups", () => {
    const either = { ...emptyFilters(), type: "wood_alternative" as const, choices: { material: ["wpc", "pvc"] } };
    expect(listProducts(previewProducts, either, "en")).toHaveLength(2);
    const both = { ...either, choices: { material: ["wpc", "pvc"], pattern: ["fluted"] } };
    expect(listProducts(previewProducts, both, "en").map((l) => l.product.slug)).toEqual(["wood-alternative-boards"]);
  });

  it("prices a product from the lowest matching purchasable variant", () => {
    const wallpaper = { ...emptyFilters(), type: "wallpaper" as const };
    expect(listProducts(previewProducts, wallpaper, "en")[0]!.fromPriceEgp).toBe(550);
    const inStock = listProducts(previewProducts, { ...wallpaper, inStockOnly: true }, "en")[0]!;
    expect(inStock.variants.every((v) => v.stock > 0)).toBe(true);
  });

  it("round-trips filters through a shareable URL and drops unknown keys", () => {
    const f = {
      ...emptyFilters(),
      type: "wood_alternative" as const,
      sort: "price_asc" as const,
      choices: { color: ["oak", "walnut"] },
      ranges: { thickness_mm: { min: 80, max: 120 } },
    };
    const qs = serializeFilters(f);
    expect(qs.get("a.color")).toBe("oak,walnut");
    expect(qs.get("r.thickness_mm")).toBe("8-12");
    const parsed = parseFilters(new URLSearchParams(`${qs.toString()}&a.nope=1`));
    expect(parsed.type).toBe("wood_alternative");
    expect(parsed.choices.color).toEqual(["oak", "walnut"]);
    expect(parsed.choices.nope).toBeUndefined();
    expect(parsed.ranges.thickness_mm).toEqual({ min: 80, max: 120 });
    expect(parseFilters(new URLSearchParams("type=ghost")).type).toBeNull();
  });
});

describe("storefront filters", () => {
  it("filters by offer kind and price, and round-trips them through the URL", () => {
    const flash = { ...emptyFilters(), offers: ["flash" as const] };
    const flashed = listProducts(previewProducts, flash, "en");
    expect(flashed.length).toBeGreaterThan(0);
    expect(flashed.every((l) => l.product.offer?.kind === "flash")).toBe(true);
    const cheap = listProducts(previewProducts, { ...emptyFilters(), priceMax: 300 }, "en");
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((l) => l.variants.every((v) => v.priceEgp <= 300))).toBe(true);
    const qs = serializeFilters({ ...emptyFilters(), offers: ["regular", "flash"], priceMin: 100, priceMax: 700, page: 2 });
    const parsed = parseFilters(new URLSearchParams(qs.toString()));
    expect(parsed.offers).toEqual(["regular", "flash"]);
    expect([parsed.priceMin, parsed.priceMax, parsed.page]).toEqual([100, 700, 2]);
  });

  it("filters the all-types listing by colour", () => {
    const f = parseFilters(new URLSearchParams("a.color=beige"));
    expect(f.choices.color).toEqual(["beige"]);
    expect(listProducts(previewProducts, f, "en").length).toBeGreaterThan(0);
  });
});

describe("MarketplaceBrowser", () => {
  beforeEach(() => {
    nav.search = "";
    nav.replace.mockClear();
  });

  it("lists sample products and offers a tab per approved type", () => {
    render(wrap(<MarketplaceBrowser />));
    const group = screen.getByRole("group", { name: "أنواع المنتجات" });
    expect(within(group).getAllByRole("button")).toHaveLength(1 + TYPE_KEYS.length);
    expect(screen.getAllByRole("article")).toHaveLength(Math.min(PAGE_SIZE, previewProducts.length));
  });

  it("generates the filters from the schema of the chosen type", () => {
    nav.search = "type=wood_alternative";
    render(wrap(<MarketplaceBrowser />));
    expect(screen.getByText("الخامة")).toBeInTheDocument();
    expect(screen.getByText("السُمك (سم)")).toBeInTheDocument();
    expect(screen.queryByText("طول الرول (سم)")).toBeNull();
  });

  it("writes a tab choice to the URL", () => {
    render(wrap(<MarketplaceBrowser />));
    fireEvent.click(screen.getByRole("button", { name: "كرانيش" }));
    expect(nav.replace).toHaveBeenCalledWith("/marketplace?type=cornice", { scroll: false });
  });

  it("shows an empty state when nothing matches", () => {
    nav.search = "q=zzzzzz";
    render(wrap(<MarketplaceBrowser />));
    expect(screen.getByText("لا توجد منتجات مطابقة")).toBeInTheDocument();
  });
});

describe("MarketplaceProductDetail", () => {
  it("resolves price and stock from the selected variant and blocks an out-of-stock add", () => {
    const product = findPreviewProduct("pvc-marble-alternative")!;
    render(wrap(<MarketplaceProductDetail product={product} />, "en"));
    expect(screen.getByText("EGP 720")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Black/ }));
    expect(screen.getByText("EGP 760")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  });

  it("adds the chosen variant to the guest cart and says so", () => {
    const product = findPreviewProduct("wall-wood-alternative")!;
    render(wrap(<MarketplaceCartProvider><MarketplaceProductDetail product={product} /></MarketplaceCartProvider>, "en"));
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(screen.getAllByRole("status").some((el) => /Added to cart/.test(el.textContent ?? ""))).toBe(true);
  });

  it("shows a carousel only when a product has several images, capped at four", () => {
    const multi = { ...findPreviewProduct("pvc-marble-alternative")!, images: ["/a.png", "/b.png", "/c.png", "/d.png", "/e.png"] };
    render(wrap(<MarketplaceProductDetail product={multi} />, "en"));
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
  });

  it("renders no carousel controls for a single image", () => {
    const single = { ...findPreviewProduct("premium-wallpaper")!, images: ["/a.png"] };
    render(wrap(<MarketplaceProductDetail product={single} />, "en"));
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByText("1 / 1")).toBeNull();
  });

  it("shows the sale unit and never mentions tax", () => {
    const product = findPreviewProduct("futec-cornices")!;
    render(wrap(<MarketplaceProductDetail product={product} />, "ar"));
    expect(screen.getAllByText("للعود").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/الضريبة/);
  });
});
