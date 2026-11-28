import { describe, expect, it } from "vitest";
import { addressLine, balanceStillDue, variantText } from "@/features/marketplace-orders/order-model";
import { isValidReturnTracking, type ReturnDocument } from "./contract";
import { returnStateText } from "./copy";

const base = {
  status: "requested",
  remedy: "refund",
  in_admin_queue: false,
  escalated_reason: null,
  refund: null,
  max_refund_egp: 150,
  timestamps: { seller_due_at: "D1", refund_due_at: "D2" },
} as unknown as ReturnDocument;
const say = (doc: Partial<ReturnDocument>, role: "buyer" | "seller") =>
  returnStateText({ ...base, ...doc } as ReturnDocument, role, "en", (d) => d, (n) => `EGP ${n}`);

describe("return state sentence", () => {
  it("tells each side who acts next and by when", () => {
    expect(say({}, "buyer")).toContain("Waiting for the showroom to reply before D1");
    expect(say({}, "seller")).toContain("Reply before D1");
    expect(say({ status: "received" }, "seller")).toContain("Pay EGP 150 back to the buyer before D2");
  });

  it("names the recorded amount while the confirmation is awaited", () => {
    const refund = { amount_egp: 120, method: "cod", state: "sent", sent_at: null, confirmed_at: null, reference_note: null } as const;
    expect(say({ status: "received", refund }, "buyer")).toContain("refund of EGP 120");
    expect(say({ status: "received", refund }, "seller")).toContain("Waiting for the buyer");
  });

  it("says a queued request is under platform review, with the reason", () => {
    expect(say({ in_admin_queue: true, escalated_reason: "complaint" }, "buyer")).toBe("Under review by the platform team. Because of a complaint.");
  });
});

describe("order display helpers", () => {
  it("accepts an empty or well-formed tracking number only", () => {
    expect(isValidReturnTracking("")).toBe(true);
    expect(isValidReturnTracking("RT-001")).toBe(true);
    expect(isValidReturnTracking("رقم 1")).toBe(false);
  });

  it("trims stored decimals in a variant label", () => {
    expect(variantText({ ar: "أبيض / 10.0000 / 53.5000", en: "White / 10.0000 / 53.5000" }, "en")).toBe("White / 10 / 53.5");
  });

  it("labels the building, floor and apartment, and keeps the stored line when there are no parts", () => {
    expect(addressLine({ street: "Test Street", building: "1", floor: "2", apartment: "3" }, "x", "en")).toBe("Test Street, Building 1, Floor 2, Apartment 3");
    expect(addressLine(null, "Old line", "ar")).toBe("Old line");
  });

  it("stops asking for a balance once nothing is left to pay", () => {
    expect(balanceStillDue({ status: "delivered", payment_status: "not_collected" })).toBe(true);
    expect(balanceStillDue({ status: "delivered", payment_status: "collected" })).toBe(false);
    expect(balanceStillDue({ status: "cancelled", payment_status: "pending" })).toBe(false);
  });
});
