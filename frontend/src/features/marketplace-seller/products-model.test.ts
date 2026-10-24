import { describe, expect, it } from "vitest";
import {
  applyFilters,
  displayState,
  paginate,
  parseFilters,
  productStats,
  stockState,
  toRow,
  type RawProduct,
  type SellerProductRow,
} from "./products-model";

const raw = (over: Partial<RawProduct> = {}): RawProduct => ({
  id: "p1",
  slug: "p1",
  name_ar: "ورق حائط مودرن",
  name_en: "Modern wallpaper",
  description_ar: null,
  description_en: null,
  status: "published",
  marketplace_product_types: { key: "wallpaper", name_ar: "ورق حائط", name_en: "Wallpaper" },
  marketplace_product_variants: [
    {
      id: "v1",
      sku: "WP-001",
      price_egp: "450.00",
      status: "active",
      marketplace_inventory_levels: [
        { location_id: "l100", on_hand: 100, reserved: 0, available: 100, marketplace_stock_locations: { is_active: true } },
        { location_id: "l20", on_hand: 20, reserved: 0, available: 20, marketplace_stock_locations: { is_active: true } },
        { location_id: "l500", on_hand: 500, reserved: 0, available: 500, marketplace_stock_locations: { is_active: false } },
      ],
    },
    {
      id: "v2",
      sku: "WP-002",
      price_egp: 400,
      status: "inactive",
      marketplace_inventory_levels: [{ location_id: "l999", on_hand: 999, reserved: 0, available: 999, marketplace_stock_locations: { is_active: true } }],
    },
  ],
  ...over,
});

const row = (over: Partial<SellerProductRow>): SellerProductRow => ({ ...toRow(raw()), ...over });

describe("toRow", () => {
  it("summarises ACTIVE variants at ACTIVE locations only", () => {
    const r = toRow(raw());
    expect(r.skus).toEqual(["WP-001"]);
    expect(r.fromPrice).toBe(450);
    expect(r.quantity).toBe(120);
    // one active variant but two active locations: no inline editing
    expect(r.inlineStock).toBeNull();
  });

  it("allows inline stock editing for one variant at one location", () => {
    const base = raw();
    const v = base.marketplace_product_variants[0]!;
    const r = toRow({ ...base, marketplace_product_variants: [{ ...v, marketplace_inventory_levels: [v.marketplace_inventory_levels[0]!] }] });
    expect(r.inlineStock).toEqual({ variantId: "v1", locationId: "l100", onHand: 100, reserved: 0, available: 100 });
  });

  it("treats a product with no active variant as nothing to sell", () => {
    const r = toRow(raw({ marketplace_product_variants: [] }));
    expect(r.fromPrice).toBeNull();
    expect(r.quantity).toBe(0);
  });
});

describe("stock rules", () => {
  it("draws the line at the low-stock threshold", () => {
    expect(stockState(0)).toBe("out");
    expect(stockState(9)).toBe("low");
    expect(stockState(10)).toBe("in");
  });

  it("lets stock lead the pill only for a product that is on sale", () => {
    expect(displayState(row({ status: "published", quantity: 0 }))).toBe("out");
    expect(displayState(row({ status: "published", quantity: 3 }))).toBe("low");
    expect(displayState(row({ status: "published", quantity: 50 }))).toBe("published");
    expect(displayState(row({ status: "draft", quantity: 0 }))).toBe("draft");
  });

  it("counts the stats over the whole catalogue", () => {
    const rows = [
      row({ id: "a", status: "published", quantity: 50 }),
      row({ id: "b", status: "published", quantity: 2 }),
      row({ id: "c", status: "draft", quantity: 0 }),
      row({ id: "d", status: "archived", quantity: 0 }),
    ];
    expect(productStats(rows)).toEqual({ total: 4, published: 2, draft: 1, lowStock: 1 });
  });
});

describe("filters and paging", () => {
  it("accepts only values the page offers", () => {
    expect(parseFilters({ type: "wallpaper", status: "published", stock: "low", q: "  wp " }, ["wallpaper"])).toEqual({
      q: "wp",
      type: "wallpaper",
      status: "published",
      stock: "low",
    });
    expect(parseFilters({ type: "x", status: "deleted", stock: "many" }, ["wallpaper"])).toEqual({
      q: undefined,
      type: undefined,
      status: undefined,
      stock: undefined,
    });
  });

  it("searches names in both languages and SKUs", () => {
    const rows = [row({ id: "a" }), row({ id: "b", nameAr: "رخام", nameEn: "Marble", skus: ["MR-203"] })];
    expect(applyFilters(rows, { q: "mr-203" }).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(rows, { q: "مودرن" }).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(rows, { stock: "in" }).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("clamps the page into range", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(paginate(items, "2", 20)).toMatchObject({ page: 2, pageCount: 3 });
    expect(paginate(items, "99", 20).page).toBe(3);
    expect(paginate(items, "abc", 20).page).toBe(1);
    expect(paginate([], "1", 20)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});
