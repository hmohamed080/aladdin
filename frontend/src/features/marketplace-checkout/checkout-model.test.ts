import { describe, expect, it } from "vitest";
import { canConfirm, idempotencyKeyFor, isMissingCode, needsReceipt, offeredPayments, type CheckoutQuote } from "./checkout-model";

const quote = (m: CheckoutQuote["payment"]["methods_enabled"]) => ({ payment: { methods_enabled: m } }) as Pick<CheckoutQuote, "payment">;

describe("checkout model", () => {
  it("confirms only when the database says ready and nothing is missing", () => {
    expect(canConfirm(null)).toBe(false);
    expect(canConfirm({ ready: false, missing: ["receipt_required"] })).toBe(false);
    expect(canConfirm({ ready: true, missing: ["address_missing"] })).toBe(false);
    expect(canConfirm({ ready: true, missing: [] })).toBe(true);
  });

  it("lists the payments the showroom offers, cash first", () => {
    expect(offeredPayments(quote({ cod: true, instapay_full: true, instapay_deposit: { deposit_percent: 30 } }))).toEqual(["cod", "instapay_full", "instapay_deposit"]);
    expect(offeredPayments(quote({ cod: false, instapay_full: false, instapay_deposit: { deposit_percent: 30 } }))).toEqual(["instapay_deposit"]);
    expect(offeredPayments(quote({ cod: false, instapay_full: false, instapay_deposit: false }))).toEqual([]);
  });

  it("asks for a receipt for every InstaPay method and never for cash", () => {
    expect(needsReceipt("cod")).toBe(false);
    expect(needsReceipt("instapay_full")).toBe(true);
    expect(needsReceipt("instapay_deposit")).toBe(true);
  });

  it("recognises the missing codes it can word", () => {
    expect(isMissingCode("receipt_required")).toBe(true);
    expect(isMissingCode("phone_unverified")).toBe(true);
    expect(isMissingCode("something_new")).toBe(false);
  });

  it("derives one stable idempotency key per session", () => {
    const id = "8e2fa447-ab36-450b-9055-5aa6b04d915f";
    expect(idempotencyKeyFor(id)).toBe(idempotencyKeyFor(id));
    expect(idempotencyKeyFor(id).length).toBeGreaterThanOrEqual(8);
    expect(idempotencyKeyFor(id)).not.toBe(idempotencyKeyFor("9e2fa447-ab36-450b-9055-5aa6b04d915f"));
  });
});
