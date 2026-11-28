import { describe, expect, it } from "vitest";
import {
  claimWindowOpen,
  draftProblem,
  hoursLeft,
  lineAcceptsClaim,
  openReasons,
  refundCap,
  returnDeadlines,
  returnErrorCode,
  visibleActions,
  windowEnd,
  type Eligibility,
  type ReturnReason,
} from "./contract";

const general: ReturnReason = {
  id: "r1", label_ar: "غيرت رأيي", label_en: "Changed my mind", claim_type: "general", requires_evidence: false, transit_damage: false, shipping_payer: "buyer",
};
const defect: ReturnReason = { ...general, id: "r2", claim_type: "defect", requires_evidence: true, shipping_payer: "seller" };
const transit: ReturnReason = { ...defect, id: "r3", transit_damage: true };

const eligibility: Eligibility = {
  eligible: true,
  window: null,
  active_return_id: null,
  reasons: [general, defect, transit],
  lines: [
    { item_id: "i1", name_ar: "أ", name_en: "A", sku: "A", variant_label: null, image_id: null, unit_price_egp: 100, quantity: 3, returnable_quantity: 2, non_returnable: false },
    { item_id: "i2", name_ar: "ب", name_en: "B", sku: "B", variant_label: null, image_id: null, unit_price_egp: 50, quantity: 1, returnable_quantity: 1, non_returnable: true },
  ],
};

describe("return window (calendar days from delivery, Africa/Cairo, ends 23:59:59 of the last day)", () => {
  it("14 days from a winter delivery ends at 23:59:59 Cairo (UTC+2)", () => {
    expect(windowEnd("2026-11-01T08:00:00Z", 14).toISOString()).toBe("2026-11-15T21:59:59.000Z");
  });
  it("uses summer time (UTC+3) when the last day falls in it", () => {
    expect(windowEnd("2026-07-01T10:00:00Z", 14).toISOString()).toBe("2026-07-15T20:59:59.000Z");
  });
  it("counts the Cairo calendar day, not the UTC day, of a late-evening delivery", () => {
    // 22:30 UTC on 1 Nov is 00:30 on 2 Nov in Cairo
    expect(windowEnd("2026-11-01T22:30:00Z", 14).toISOString()).toBe("2026-11-16T21:59:59.000Z");
  });
  it("30 days across the end of summer time", () => {
    expect(windowEnd("2026-10-20T10:00:00Z", 30).toISOString()).toBe("2026-11-19T21:59:59.000Z");
  });
  it("a showroom may offer more days than the floor, never fewer", () => {
    const d = returnDeadlines({ deliveredAt: "2026-11-01T08:00:00Z", generalDays: 7, defectDays: 10 });
    expect(d.general.toISOString()).toBe("2026-11-15T21:59:59.000Z");
    expect(d.defect.toISOString()).toBe("2026-12-01T21:59:59.000Z");
    expect(returnDeadlines({ deliveredAt: "2026-11-01T08:00:00Z", generalDays: 21 }).general.toISOString()).toBe("2026-11-22T21:59:59.000Z");
  });
});

describe("claim windows", () => {
  const d = returnDeadlines({ deliveredAt: "2026-11-01T08:00:00Z" });
  it("a general claim closes after 14 days, a defect claim after 30", () => {
    const day15 = new Date("2026-11-16T10:00:00Z");
    expect(claimWindowOpen("general", false, d, new Date("2026-11-15T21:59:59Z"))).toBe(true);
    expect(claimWindowOpen("general", false, d, day15)).toBe(false);
    expect(claimWindowOpen("defect", false, d, day15)).toBe(true);
    expect(claimWindowOpen("defect", false, d, new Date("2026-12-02T00:00:00Z"))).toBe(false);
  });
  it("visible transit damage must be reported within 48 hours of delivery", () => {
    expect(claimWindowOpen("defect", true, d, new Date("2026-11-03T07:59:00Z"))).toBe(true);
    expect(claimWindowOpen("defect", true, d, new Date("2026-11-03T08:01:00Z"))).toBe(false);
  });
  it("lists only the reasons whose window is still open", () => {
    const late = new Date("2026-11-20T00:00:00Z");
    expect(openReasons([general, defect, transit], d, late).map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("lines and drafts", () => {
  it("a made-to-order line accepts only a defect claim; a sold-out line accepts nothing", () => {
    const l = eligibility.lines[1]!;
    expect(lineAcceptsClaim(l, "general")).toBe(false);
    expect(lineAcceptsClaim(l, "defect")).toBe(true);
    expect(lineAcceptsClaim({ non_returnable: false, returnable_quantity: 0 }, "general")).toBe(false);
  });
  it("reports why a draft cannot be sent", () => {
    const base = { eligibility, evidenceCount: 0 };
    expect(draftProblem({ ...base, lines: [], reason: general })).toBe("no_lines");
    expect(draftProblem({ ...base, lines: [{ item_id: "i1", quantity: 1 }], reason: null })).toBe("no_reason");
    expect(draftProblem({ ...base, lines: [{ item_id: "i1", quantity: 3 }], reason: general })).toBe("quantity");
    expect(draftProblem({ ...base, lines: [{ item_id: "i2", quantity: 1 }], reason: general })).toBe("not_returnable");
    expect(draftProblem({ ...base, lines: [{ item_id: "i1", quantity: 1 }], reason: defect })).toBe("evidence_required");
    expect(draftProblem({ ...base, evidenceCount: 1, lines: [{ item_id: "i2", quantity: 1 }], reason: defect })).toBeNull();
    expect(draftProblem({ ...base, lines: [{ item_id: "i1", quantity: 2 }], reason: general })).toBeNull();
  });
});

describe("deadlines, refunds, actions", () => {
  it("hours left never goes negative and rounds up", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(hoursLeft("2026-11-01T00:30:00Z", now)).toBe(1);
    expect(hoursLeft("2026-10-31T00:00:00Z", now)).toBe(0);
    expect(hoursLeft(null, now)).toBe(0);
  });
  it("the refund is the value of the returned units, capped by a partial proposal", () => {
    const items = [{ line_total_egp: 200 }, { line_total_egp: 50 }];
    expect(refundCap(items, null)).toBe(250);
    expect(refundCap(items, 120)).toBe(120);
    expect(refundCap(items, 900)).toBe(250);
  });
  it("shows only the actions the database listed and ignores unknown names", () => {
    expect(visibleActions({ actions: ["cancel", "future_action" as never] }, ["cancel", "mark_shipped"])).toEqual(["cancel"]);
  });
  it("maps unknown error codes to unexpected", () => {
    expect(returnErrorCode("return_window_closed")).toBe("return_window_closed");
    expect(returnErrorCode("whatever")).toBe("unexpected");
  });
});
