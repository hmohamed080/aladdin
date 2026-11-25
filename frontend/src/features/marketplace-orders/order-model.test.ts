import { describe, expect, it } from "vitest";
import {
  buyerOrdersHref,
  collectOnDelivery,
  customReasonPayload,
  formatEstimate,
  hoursLeft,
  isReadyForPickup,
  isValidTracking,
  knownActions,
  latestSubmittedReceipt,
  parseBuyerOrdersQuery,
  parseSellerOrdersQuery,
  progressIndex,
  reorderLines,
  sellerOrdersHref,
} from "./order-model";
import type { OrderDocumentV2 } from "./order-types";

describe("progress bar", () => {
  it("maps the new statuses onto placed, preparing, shipped, delivered", () => {
    expect(progressIndex("new", "delivery")).toBe(0);
    expect(progressIndex("preparing", "delivery")).toBe(1);
    expect(progressIndex("ready", "delivery")).toBe(1);
    expect(progressIndex("shipped", "delivery")).toBe(2);
    expect(progressIndex("delivered", "pickup")).toBe(3);
  });
  it("takes a cancelled or returned order off the line", () => {
    expect(progressIndex("cancelled", "delivery")).toBeNull();
    expect(progressIndex("returned", "delivery")).toBeNull();
  });
  it("still reads old statuses", () => {
    expect(progressIndex("pending_confirmation", "delivery")).toBe(0);
    expect(progressIndex("processing", "delivery")).toBe(1);
  });
  it("tells a pickup order that waits for the buyer", () => {
    expect(isReadyForPickup("ready", "pickup")).toBe(true);
    expect(isReadyForPickup("ready", "delivery")).toBe(false);
  });
});

describe("buyer list query", () => {
  it("defaults to the last three months and drops junk", () => {
    expect(parseBuyerOrdersQuery({ period: "forever", status: "x", page: "-2" })).toEqual({ search: "", period: "3m", status: null, page: 1 });
  });
  it("round-trips through the address", () => {
    const q = parseBuyerOrdersQuery({ q: " tile ", period: "1y", status: "active", page: "2" });
    expect(q).toEqual({ search: "tile", period: "1y", status: "active", page: 2 });
    expect(buyerOrdersHref(q)).toBe("/market/orders?q=tile&period=1y&status=active&page=2");
    expect(buyerOrdersHref({ period: "3m" })).toBe("/market/orders");
  });
});

describe("seller list query", () => {
  it("accepts only real calendar days and orders the range", () => {
    expect(parseSellerOrdersQuery({ from: "2026-02-30", to: "2026-03-01" }).from).toBeNull();
    const q = parseSellerOrdersQuery({ tab: "shipped", from: "2026-03-10", to: "2026-03-01" });
    expect(q).toMatchObject({ tab: "shipped", from: "2026-03-01", to: "2026-03-10" });
    expect(sellerOrdersHref(q)).toBe("/showroom/marketplace/orders?tab=shipped&from=2026-03-01&to=2026-03-10");
  });
  it("ignores an unknown tab (the removed awaiting-confirmation tab included)", () => {
    expect(parseSellerOrdersQuery({ tab: "pending_confirmation" }).tab).toBeNull();
  });
});

describe("action registry", () => {
  it("ignores action names it does not know", () => {
    const registry = { cancel: 1, start_preparing: 2 };
    expect(knownActions(["start_preparing", "file_complaint", "cancel", "toString"], registry).map((a) => a.key)).toEqual(["start_preparing", "cancel"]);
  });
});

describe("receipts and money", () => {
  const doc = (receipts: { id: string; status: "submitted" | "accepted" | "rejected" | "superseded" }[]) =>
    ({ payment: { receipts } }) as unknown as Pick<OrderDocumentV2, "payment">;
  it("picks the newest receipt that is still waiting", () => {
    expect(latestSubmittedReceipt(doc([{ id: "a", status: "superseded" }, { id: "b", status: "submitted" }, { id: "c", status: "accepted" }]))?.id).toBe("b");
    expect(latestSubmittedReceipt(doc([{ id: "a", status: "accepted" }]))).toBeNull();
  });
  it("collects the balance only until the payment is settled", () => {
    const base = { payment_method: "cod" as const, totals: { balance_due_egp: 120 } };
    expect(collectOnDelivery({ ...base, payment_status: "pending" } as never)).toBe(120);
    expect(collectOnDelivery({ ...base, payment_status: "collected" } as never)).toBe(0);
  });
});

describe("shipment and reason input", () => {
  it("validates tracking numbers like the database does", () => {
    expect(isValidTracking("EG-12345/A")).toBe(true);
    expect(isValidTracking("ab")).toBe(false);
    expect(isValidTracking("has space")).toBe(false);
  });
  it("copies one typed reason into both languages", () => {
    expect(customReasonPayload("نفد المخزون", "")).toEqual({ message_ar: "نفد المخزون", message_en: "نفد المخزون" });
    expect(customReasonPayload("", "")).toBeNull();
    expect(customReasonPayload("ab", "")).toBeNull();
    expect(customReasonPayload("x".repeat(301), "")).toBeNull();
  });
});

describe("dates", () => {
  it("writes the estimate as calendar days, whatever the viewer's zone", () => {
    expect(formatEstimate({ earliest: "2026-12-12", latest: "2026-12-14" }, "en")).toBe("12–14 Dec");
    expect(formatEstimate({ earliest: "2026-12-12", latest: "2026-12-12" }, "en")).toBe("12 Dec");
    expect(formatEstimate(null, "en")).toBeNull();
  });
  it("counts hours left up to a deadline, never below zero", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(hoursLeft("2026-12-01T05:30:00Z", now)).toBe(6);
    expect(hoursLeft("2026-11-30T00:00:00Z", now)).toBe(0);
    expect(hoursLeft(null, now)).toBeNull();
  });
});

describe("reorder", () => {
  it("sends slug, sku and quantity only, and skips a line without a product link", () => {
    expect(
      reorderLines([
        { slug: "porcelain-60", sku: "P-1", quantity: 3 },
        { slug: null, sku: "X", quantity: 1 },
        { slug: "Bad Slug", sku: "Y", quantity: 1 },
        { slug: "paint", sku: "PA", quantity: 20000 },
      ]),
    ).toEqual([
      { slug: "porcelain-60", sku: "P-1", qty: 3 },
      { slug: "paint", sku: "PA", qty: 9999 },
    ]);
  });
});
