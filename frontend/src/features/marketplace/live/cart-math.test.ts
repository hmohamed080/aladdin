import { describe, expect, it } from "vitest";
import { clampQty, parseStoredCart, priceCart } from "./cart-math";
import type { CartQuote, CartQuoteLine, CartSeller } from "./public-contract";

const line = (sku: string, seller: number, price: number, available = 100, slug = `p-${sku}`): CartQuoteLine => ({
  status: "ok", slug, sku, name_ar: "ع", name_en: "N", brand: null, selling_unit: "piece", price_egp: price, available, seller, image_id: null, attributes: [],
});
const seller = (index: number, fee: number | "none" | "needs_area", pickup = false): CartSeller => ({
  index,
  name: `Showroom ${index}`,
  pickup_available: pickup,
  delivery: fee === "none" ? { status: "not_available" } : fee === "needs_area" ? { status: "needs_area" } : { status: "available", fee_egp: fee },
});
const stored = (...items: [string, number][]) => items.map(([sku, qty]) => ({ slug: `p-${sku}`, sku, qty }));

describe("pricing the cart", () => {
  it("totals products + delivery and adds no tax line (prices exclude VAT, DL-16)", () => {
    const quote: CartQuote = { lines: [line("A", 1, 785)], sellers: [seller(1, 80)] };
    const t = priceCart(quote, stored(["A", 2]), "delivery");
    expect(t.productsEgp).toBe(1570);
    expect(t.deliveryEgp).toBe(80);
    expect(t.totalEgp).toBe(1650);
    expect(t).not.toHaveProperty("vatEgp");
    expect(t.state).toBe("ok");
  });

  it("sums each showroom's own delivery price when the cart spans showrooms", () => {
    const quote: CartQuote = { lines: [line("A", 1, 100), line("B", 2, 200)], sellers: [seller(1, 60), seller(2, 90)] };
    const t = priceCart(quote, stored(["A", 1], ["B", 2]), "delivery");
    expect(t.productsEgp).toBe(500);
    expect(t.deliveryEgp).toBe(150);
    expect(t.perSeller.map((p) => p.feeEgp)).toEqual([60, 90]);
    expect(t.totalEgp).toBe(650);
  });

  it("blocks delivery — and prices nothing — while one showroom does not deliver there", () => {
    const quote: CartQuote = { lines: [line("A", 1, 100), line("B", 2, 200)], sellers: [seller(1, 60), seller(2, "none")] };
    const t = priceCart(quote, stored(["A", 1], ["B", 1]), "delivery");
    expect(t.state).toBe("not_available");
    expect(t.deliveryEgp).toBeNull();
    expect(t.blockedBy.map((s) => s.name)).toEqual(["Showroom 2"]);
  });

  it("asks for a place before pricing delivery", () => {
    const quote: CartQuote = { lines: [line("A", 1, 100)], sellers: [seller(1, "needs_area")] };
    const t = priceCart(quote, stored(["A", 1]), "delivery");
    expect(t.state).toBe("needs_area");
    expect(t.deliveryEgp).toBeNull();
  });

  it("pickup costs no delivery, and only works when every showroom offers it", () => {
    const quote: CartQuote = { lines: [line("A", 1, 100), line("B", 2, 100)], sellers: [seller(1, 60, true), seller(2, 60, false)] };
    const blocked = priceCart(quote, stored(["A", 1], ["B", 1]), "pickup");
    expect(blocked.state).toBe("pickup_unavailable");
    expect(blocked.blockedBy.map((s) => s.name)).toEqual(["Showroom 2"]);
    const ok = priceCart({ lines: [line("A", 1, 100)], sellers: [seller(1, "none", true)] }, stored(["A", 1]), "pickup");
    expect(ok.state).toBe("ok");
    expect(ok.deliveryEgp).toBe(0);
    expect(ok.totalEgp).toBe(100);
  });

  it("never charges more than the showroom has, and says so", () => {
    const quote: CartQuote = { lines: [line("A", 1, 100, 3)], sellers: [seller(1, 0)] };
    const t = priceCart(quote, stored(["A", 9]), "delivery");
    expect(t.lines[0]).toMatchObject({ qty: 3, reduced: true, lineTotalEgp: 300 });
  });

  it("leaves an out-of-stock line and a vanished product out of the totals and out of delivery", () => {
    const quote: CartQuote = {
      lines: [line("A", 1, 100, 5), line("B", 2, 999, 0), { status: "unavailable", slug: "p-C", sku: "C" }],
      sellers: [seller(1, 40), seller(2, "none")],
    };
    const t = priceCart(quote, stored(["A", 1], ["B", 1], ["C", 1]), "delivery");
    expect(t.productsEgp).toBe(100);
    expect(t.lines.find((l) => l.sku === "B")).toMatchObject({ outOfStock: true, qty: 0 });
    expect(t.unavailable).toHaveLength(1);
    // showroom 2 has nothing left to ship, so its missing delivery price does not block the order
    expect(t.state).toBe("ok");
    expect(t.deliveryEgp).toBe(40);
  });

  it("rounds money to piastres", () => {
    const quote: CartQuote = { lines: [line("A", 1, 33.33)], sellers: [seller(1, 10.1)] };
    const t = priceCart(quote, stored(["A", 3]), "delivery");
    expect(t.productsEgp).toBe(99.99);
    expect(t.totalEgp).toBe(110.09);
  });
});

describe("quantity and stored cart hygiene", () => {
  it("keeps a quantity a whole number between 1 and what is available", () => {
    expect(clampQty(0, 10)).toBe(1);
    expect(clampQty(2.6, 10)).toBe(3);
    expect(clampQty(50, 10)).toBe(10);
    expect(clampQty(Number.NaN, 10)).toBe(1);
    expect(clampQty(5, 0)).toBe(1);
    expect(clampQty(100000, 100000)).toBe(9999);
  });

  it("drops malformed, duplicate and oversized stored lines", () => {
    const raw = JSON.stringify([
      { slug: "ok-slug", sku: "S1", qty: 2 },
      { slug: "ok-slug", sku: "S1", qty: 7 },
      { slug: "Bad Slug!", sku: "S2", qty: 1 },
      { slug: "ok-slug", sku: "", qty: 1 },
      { slug: "ok-slug", sku: "S3", qty: "3" },
      { slug: "ok-slug", sku: "S4", qty: 123456 },
      null,
      "x",
    ]);
    expect(parseStoredCart(raw)).toEqual([
      { slug: "ok-slug", sku: "S1", qty: 2 },
      { slug: "ok-slug", sku: "S4", qty: 9999 },
    ]);
    expect(parseStoredCart("not json")).toEqual([]);
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("holds at most 50 lines", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ slug: `p-${i}`, sku: `S${i}`, qty: 1 }));
    expect(parseStoredCart(JSON.stringify(many))).toHaveLength(50);
  });
});
