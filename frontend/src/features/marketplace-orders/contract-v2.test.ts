import { describe, expect, it } from "vitest";
import { buyerCanCancel, buyerMaySendProof, isV2Order, sellerActionsV2For } from "./contract";

const base = { fulfilment: "delivery", payment_method: "cod", payment_status: "pending" } as const;

describe("v2 seller actions (no confirm, no reject)", () => {
  it("a new order is started or cancelled, never confirmed", () => {
    const a = sellerActionsV2For({ ...base, status: "new" });
    expect(a).toEqual(["start_preparing", "cancel"]);
    expect(a).not.toContain("confirm" as never);
  });

  it("follows the machine: preparing -> ready -> shipped -> delivered -> collect", () => {
    expect(sellerActionsV2For({ ...base, status: "preparing" })).toEqual(["mark_ready", "cancel"]);
    expect(sellerActionsV2For({ ...base, status: "ready" })).toEqual(["mark_shipped", "cancel"]);
    expect(sellerActionsV2For({ ...base, status: "ready", fulfilment: "pickup" })).toEqual(["mark_delivered", "cancel", "mark_delivery_failed"]);
    expect(sellerActionsV2For({ ...base, status: "shipped" })).toEqual(["mark_delivered", "mark_delivery_failed"]);
    expect(sellerActionsV2For({ ...base, status: "delivered" })).toEqual(["collect_payment"]);
    expect(sellerActionsV2For({ ...base, status: "delivery_failed" })).toEqual(["mark_returned_to_stock"]);
  });

  it("a disputed receipt freezes progress and offers receipt review", () => {
    const o = { fulfilment: "delivery", payment_method: "instapay_full", payment_status: "receipt_disputed" } as const;
    const a = sellerActionsV2For({ ...o, status: "preparing" });
    expect(a).not.toContain("mark_ready");
    expect(a).toContain("accept_receipt");
  });

  it("flags a submitted receipt only for InstaPay orders in preparation or ready", () => {
    const o = { fulfilment: "delivery", payment_method: "instapay_deposit", payment_status: "receipt_submitted" } as const;
    expect(sellerActionsV2For({ ...o, status: "preparing" })).toEqual(["mark_ready", "cancel", "accept_receipt", "flag_receipt_not_received"]);
    expect(sellerActionsV2For({ ...o, status: "new" })).toEqual(["start_preparing", "cancel", "accept_receipt"]);
  });

  it("never ships or hands over an InstaPay order before the transfer is confirmed", () => {
    const o = { fulfilment: "delivery", payment_method: "instapay_full", payment_status: "receipt_submitted" } as const;
    expect(sellerActionsV2For({ ...o, status: "ready" })).not.toContain("mark_shipped");
    expect(sellerActionsV2For({ ...o, status: "ready", fulfilment: "pickup" })).not.toContain("mark_delivered");
    expect(sellerActionsV2For({ ...o, status: "ready", payment_status: "collected" })).toContain("mark_shipped");
  });

  it("collects the balance of an accepted deposit once delivered", () => {
    const o = { fulfilment: "delivery", payment_method: "instapay_deposit", payment_status: "receipt_accepted", balance_due_egp: 182 } as const;
    expect(sellerActionsV2For({ ...o, status: "delivered" })).toEqual(["collect_payment"]);
    expect(sellerActionsV2For({ ...o, status: "delivered", balance_due_egp: 0 })).toEqual([]);
  });
});

describe("buyer rules for v2 orders", () => {
  it("cancels only while the order is new", () => {
    expect(buyerCanCancel({ status: "new" })).toBe(true);
    expect(buyerCanCancel({ status: "preparing" })).toBe(false);
  });
  it("re-sends a receipt only after the showroom said the money did not arrive", () => {
    expect(buyerMaySendProof({ status: "preparing", payment_method: "instapay_full", payment_status: "receipt_disputed" })).toBe(true);
    expect(buyerMaySendProof({ status: "preparing", payment_method: "instapay_full", payment_status: "receipt_submitted" })).toBe(false);
    expect(buyerMaySendProof({ status: "new", payment_method: "cod", payment_status: "pending" })).toBe(false);
  });
  it("tells v2 orders from legacy ones", () => {
    expect(isV2Order({ status: "new" })).toBe(true);
    expect(isV2Order({ status: "pending_confirmation" })).toBe(false);
    expect(isV2Order({ status: "delivered", source: "v2" })).toBe(true);
  });
});
