import { describe, expect, it } from "vitest";
import { countdownText, dateRangeText, dateText, daysRangeText, estimateText, feeText, freeReasonText, placeFromParams } from "./delivery-model";
import type { DeliveryTerms } from "./public-contract";

const terms = (patch: Partial<DeliveryTerms> = {}): DeliveryTerms => ({
  configured: true, status: "available", fee_egp: 80, fee_min_egp: null, fee_max_egp: null, prep_days: 2, min_days: 3, max_days: 4,
  earliest: "2026-11-26", latest: "2026-11-27", cutoff_time: "14:00", after_cutoff: false, seconds_to_cutoff: 3600, free_min_egp: null,
  next_day: null, pickup_available: false, pickup_instructions: null, free_shipping: false, free_reason: null, product_free: false, ...patch,
});

describe("placeFromParams", () => {
  it("accepts a governorate with or without an area", () => {
    expect(placeFromParams("cairo", "nasr-city")).toEqual({ gov: "cairo", area: "nasr-city" });
    expect(placeFromParams("cairo", undefined)).toEqual({ gov: "cairo", area: "" });
  });
  it("refuses anything that is not a place key, and an area without a governorate", () => {
    expect(placeFromParams(undefined, "nasr-city")).toBeNull();
    expect(placeFromParams("Cairo; drop", "x")).toBeNull();
    expect(placeFromParams("cairo", "Bad Key")).toEqual({ gov: "cairo", area: "" });
  });
});

describe("estimate wording", () => {
  it("words a range, a single day and today in both languages", () => {
    expect(daysRangeText(3, 4, "en")).toBe("3–4 days");
    expect(daysRangeText(1, 1, "en")).toBe("1 day");
    expect(daysRangeText(0, 0, "en")).toBe("today");
    expect(daysRangeText(3, 4, "ar")).toContain("أيام");
    expect(daysRangeText(1, 1, "ar")).toBe("يوم واحد");
    expect(daysRangeText(12, 14, "ar")).toContain("يومًا");
  });
  it("says nothing when the showroom has not configured delivery or does not deliver there", () => {
    expect(estimateText({ status: "available", configured: false, min_days: null, max_days: null, pickup_available: false }, "en")).toBeNull();
    expect(estimateText({ status: "not_available", configured: true, min_days: 3, max_days: 4, pickup_available: false }, "en")).toBeNull();
    expect(estimateText(undefined, "en")).toBeNull();
  });
  it("words the estimate", () => {
    expect(estimateText({ status: "needs_area", configured: true, min_days: 3, max_days: 7, pickup_available: false }, "en")).toBe("Arrives in 3–7 days");
    expect(estimateText({ status: "available", configured: true, min_days: 0, max_days: 0, pickup_available: false }, "en")).toBe("Arrives today");
  });
});

describe("dates and countdown", () => {
  it("formats a calendar day without a time-zone shift", () => {
    expect(dateText("2026-11-26", "en")).toMatch(/Thu.*26.*Nov/);
    expect(dateRangeText("2026-11-26", "2026-11-26", "en")).toBe(dateText("2026-11-26", "en"));
    expect(dateRangeText("2026-11-26", "2026-11-27", "en")).toContain("–");
  });
  it("formats a countdown and never goes negative", () => {
    expect(countdownText(3661)).toBe("01:01:01");
    expect(countdownText(-5)).toBe("00:00:00");
  });
});

describe("fee and free-shipping wording", () => {
  it("shows Free, the fee, or nothing while no place is chosen", () => {
    expect(feeText(terms({ free_shipping: true, free_reason: "product" }), "en")).toBe("Free");
    expect(feeText(terms(), "en")).toBe("EGP 80");
    expect(feeText(terms({ status: "needs_area", fee_egp: null }), "en")).toBeNull();
  });
  it("explains free shipping and offers the threshold when it is not met yet", () => {
    expect(freeReasonText(terms({ free_shipping: true, free_reason: "product" }), "en")).toBe("Free shipping");
    expect(freeReasonText(terms({ free_min_egp: 1000 }), "en")).toBe("Free shipping on orders from EGP 1,000");
    expect(freeReasonText(terms(), "en")).toBeNull();
  });
});
