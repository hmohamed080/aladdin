import { describe, expect, it } from "vitest";
import type { CartQuote, CartQuoteLine, CartSeller } from "@/features/marketplace/live/public-contract";
import { buildCheckout, defaultChoice } from "./checkout-model";
import { buyerMaySendProof, isValidPhone, sellerActionsFor } from "./contract";

const ok = (sku: string, seller: number, price: number, available: number): CartQuoteLine => ({
  status: "ok", slug: `p-${sku.toLowerCase()}`, sku, name_ar: sku, name_en: sku, brand: null, selling_unit: "piece",
  price_egp: price, available, seller, image_id: null, attributes: [],
});
const seller = (index: number, over: Partial<CartSeller> = {}): CartSeller => ({
  index, name: `S${index}`, pickup_available: false, delivery: { status: "available", fee_egp: 50 },
  payment_methods: { cod: true, instapay: null }, ...over,
});

describe("checkout model", () => {
  it("numbers showrooms by first appearance among the lines it sends, skipping what cannot be ordered", () => {
    const quote: CartQuote = {
      lines: [{ status: "unavailable", slug: "gone", sku: "X" }, ok("B", 2, 100, 5), ok("A", 1, 10, 0), ok("C", 1, 20, 3)],
      sellers: [seller(1), seller(2)],
    };
    const v = buildCheckout(quote, [{ slug: "gone", sku: "X", qty: 1 }, { slug: "p-b", sku: "B", qty: 9 }, { slug: "p-a", sku: "A", qty: 1 }, { slug: "p-c", sku: "C", qty: 2 }], {});
    expect(v.skipped).toBe(2);
    expect(v.submitLines).toEqual([{ slug: "p-b", sku: "B", qty: 5 }, { slug: "p-c", sku: "C", qty: 2 }]);
    expect(v.sellers.map((s) => [s.seller.index, s.submitIndex])).toEqual([[2, 1], [1, 2]]);
    expect(v.sellers[0]!.totalEgp).toBe(550);
    expect(v.grandTotalEgp).toBe(550 + 90);
  });

  it("prices an InstaPay deposit on the order total and blocks a choice the showroom does not offer", () => {
    const quote: CartQuote = { lines: [ok("A", 1, 333.33, 9)], sellers: [seller(1, { payment_methods: { cod: false, instapay: { deposit_percent: 30 } }, pickup_available: true })] };
    const lines = [{ slug: "p-a", sku: "A", qty: 3 }];
    const v = buildCheckout(quote, lines, {});
    expect(v.sellers[0]!.choice).toEqual({ fulfilment: "delivery", payment: "instapay" });
    expect(v.sellers[0]!.depositEgp).toBe(315);
    expect(v.sellers[0]!.ready).toBe(true);
    const pickup = buildCheckout(quote, lines, { 1: { fulfilment: "pickup", payment: "cod" } });
    expect(pickup.sellers[0]!.feeEgp).toBe(0);
    expect(pickup.sellers[0]!.ready).toBe(false);
    expect(pickup.needsAddress).toBe(false);
  });

  it("has no payment default when the showroom turned none on", () => {
    expect(defaultChoice(seller(1, { payment_methods: { cod: false, instapay: null }, delivery: { status: "not_available" } }))).toEqual({ fulfilment: null, payment: null });
  });
});

describe("order rules", () => {
  it("lets a showroom confirm an InstaPay order only after the deposit is accepted", () => {
    const base = { status: "pending_confirmation", fulfilment: "delivery", payment_method: "instapay" } as const;
    expect(sellerActionsFor({ ...base, payment_status: "deposit_submitted" })).toEqual(["cancel"]);
    expect(sellerActionsFor({ ...base, payment_status: "deposit_accepted" })).toEqual(["confirm", "cancel"]);
    expect(sellerActionsFor({ ...base, status: "processing", fulfilment: "pickup", payment_status: "collected" })).toEqual(["ready", "cancel"]);
    expect(sellerActionsFor({ ...base, status: "delivered", payment_status: "collected" })).toEqual([]);
  });

  it("asks the buyer for a receipt while waiting for the deposit or after a rejection", () => {
    const o = { status: "pending_confirmation", payment_method: "instapay" } as const;
    expect(buyerMaySendProof({ ...o, payment_status: "awaiting_deposit" })).toBe(true);
    expect(buyerMaySendProof({ ...o, payment_status: "deposit_rejected" })).toBe(true);
    expect(buyerMaySendProof({ ...o, payment_status: "deposit_submitted" })).toBe(false);
  });

  it("accepts phone numbers the way the database does", () => {
    expect(isValidPhone("010 1234-5678")).toBe(true);
    expect(isValidPhone("+201012345678")).toBe(true);
    expect(isValidPhone("12ab")).toBe(false);
  });
});
