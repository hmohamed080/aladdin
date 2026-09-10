import { describe, expect, it } from "vitest";

import {
  DASHBOARD_PERIOD_ORDER,
  DEFAULT_DASHBOARD_PERIOD,
  dashboardPeriodRange,
  isValidCustomRange,
  previousDashboardPeriodRange,
  resolveDashboardPeriod,
} from "./dashboard-period";

const CAIRO = "Africa/Cairo";

describe("resolveDashboardPeriod treats the URL as untrusted input", () => {
  it("accepts every rolling/calendar period it offers", () => {
    for (const key of ["7d", "30d", "90d", "thisMonth", "thisQuarter"] as const) {
      expect(resolveDashboardPeriod(key, undefined, undefined)).toBe(key);
    }
  });

  it("falls back rather than passing anything through", () => {
    expect(resolveDashboardPeriod(undefined, undefined, undefined)).toBe("30d");
    expect(resolveDashboardPeriod("", undefined, undefined)).toBe("30d");
    expect(resolveDashboardPeriod("400d", undefined, undefined)).toBe("30d");
    expect(resolveDashboardPeriod("__proto__", undefined, undefined)).toBe("30d");
  });

  it("lets a caller name its own default", () => {
    expect(resolveDashboardPeriod("nonsense", undefined, undefined, "90d")).toBe("90d");
  });

  it("accepts custom only with a valid, ordered from/to pair", () => {
    expect(resolveDashboardPeriod("custom", "2026-01-01", "2026-01-31")).toBe("custom");
    expect(resolveDashboardPeriod("custom", undefined, "2026-01-31")).toBe("30d");
    expect(resolveDashboardPeriod("custom", "2026-01-31", "2026-01-01")).toBe("30d");
    expect(resolveDashboardPeriod("custom", "not-a-date", "2026-01-31")).toBe("30d");
    // A single day is a legal (zero-length-plus-one) custom range, not an error.
    expect(resolveDashboardPeriod("custom", "2026-01-01", "2026-01-01")).toBe("custom");
  });
});

describe("the offered option set", () => {
  it("runs shortest rolling window to longest, calendar windows next, custom last", () => {
    expect(DASHBOARD_PERIOD_ORDER).toEqual(["7d", "30d", "90d", "thisMonth", "thisQuarter", "custom"]);
    expect(new Set(DASHBOARD_PERIOD_ORDER).size).toBe(DASHBOARD_PERIOD_ORDER.length);
  });

  it("offers the default, which is what makes the bare URL a legal state", () => {
    expect(DASHBOARD_PERIOD_ORDER).toContain(DEFAULT_DASHBOARD_PERIOD);
    expect(resolveDashboardPeriod(undefined, undefined, undefined)).toBe(DEFAULT_DASHBOARD_PERIOD);
  });
});

// A fixed instant so every assertion below is deterministic regardless of when
// the suite runs. 2026-03-15 12:00 UTC is 2026-03-15 14:00 in Cairo (UTC+2) —
// safely inside the day, nowhere near a UTC midnight boundary.
const NOW = new Date("2026-03-15T12:00:00Z");

describe("dashboardPeriodRange — rolling windows", () => {
  it("7d/30d/90d are inclusive windows of exactly that many calendar days, ending today", () => {
    expect(dashboardPeriodRange("7d", NOW, CAIRO)).toEqual({ key: "7d", from: "2026-03-09", to: "2026-03-15" });
    expect(dashboardPeriodRange("30d", NOW, CAIRO)).toEqual({ key: "30d", from: "2026-02-14", to: "2026-03-15" });
    expect(dashboardPeriodRange("90d", NOW, CAIRO)).toEqual({ key: "90d", from: "2025-12-16", to: "2026-03-15" });
  });
});

describe("dashboardPeriodRange — calendar windows", () => {
  it("thisMonth starts on the 1st of the current calendar month", () => {
    expect(dashboardPeriodRange("thisMonth", NOW, CAIRO)).toEqual({
      key: "thisMonth",
      from: "2026-03-01",
      to: "2026-03-15",
    });
  });

  it("thisQuarter starts on the 1st of the current quarter's first month", () => {
    // March is in Q1 (Jan-Mar).
    expect(dashboardPeriodRange("thisQuarter", NOW, CAIRO)).toEqual({
      key: "thisQuarter",
      from: "2026-01-01",
      to: "2026-03-15",
    });
    // A date in Q2 (Apr-Jun) starts from April.
    const juneNow = new Date("2026-06-10T12:00:00Z");
    expect(dashboardPeriodRange("thisQuarter", juneNow, CAIRO)).toEqual({
      key: "thisQuarter",
      from: "2026-04-01",
      to: "2026-06-10",
    });
  });
});

describe("dashboardPeriodRange — custom", () => {
  it("uses the given range verbatim when valid", () => {
    expect(dashboardPeriodRange("custom", NOW, CAIRO, { from: "2026-01-05", to: "2026-01-20" })).toEqual({
      key: "custom",
      from: "2026-01-05",
      to: "2026-01-20",
    });
  });

  it("degrades to the default window rather than throwing on a missing/invalid pair", () => {
    expect(dashboardPeriodRange("custom", NOW, CAIRO)).toEqual(dashboardPeriodRange("30d", NOW, CAIRO));
    expect(dashboardPeriodRange("custom", NOW, CAIRO, { from: "2026-02-01", to: "2026-01-01" })).toEqual(
      dashboardPeriodRange("30d", NOW, CAIRO),
    );
  });
});

describe("dashboardPeriodRange — timezone actually changes the answer", () => {
  it("a UTC-11 zone can still be 'yesterday' when Cairo has already turned over", () => {
    // 2026-03-15T00:30:00Z is 2026-03-15 02:30 in Cairo (UTC+2, already the
    // 15th) but 2026-03-14 13:30 in Pago Pago (UTC-11, still the 14th).
    const boundary = new Date("2026-03-15T00:30:00Z");
    expect(dashboardPeriodRange("thisMonth", boundary, "Africa/Cairo").to).toBe("2026-03-15");
    expect(dashboardPeriodRange("thisMonth", boundary, "Pacific/Pago_Pago").to).toBe("2026-03-14");
  });
});

describe("isValidCustomRange", () => {
  it("requires both dates, ISO shape, and a non-inverted order", () => {
    expect(isValidCustomRange("2026-01-01", "2026-01-31")).toBe(true);
    expect(isValidCustomRange("2026-01-01", "2026-01-01")).toBe(true);
    expect(isValidCustomRange(undefined, "2026-01-31")).toBe(false);
    expect(isValidCustomRange("2026-01-31", "2026-01-01")).toBe(false);
    expect(isValidCustomRange("01/01/2026", "2026-01-31")).toBe(false);
  });
});

describe("previousDashboardPeriodRange", () => {
  it("shifts a rolling window back by its own length, with no gap or overlap", () => {
    const current = dashboardPeriodRange("7d", NOW, CAIRO); // 2026-03-09..15
    const previous = previousDashboardPeriodRange(current, CAIRO);
    expect(previous).toEqual({ key: "7d", from: "2026-03-02", to: "2026-03-08" });
  });

  it("compares thisMonth against the same number of days into the previous calendar month", () => {
    const current = dashboardPeriodRange("thisMonth", NOW, CAIRO); // 2026-03-01..15 (15 days in)
    const previous = previousDashboardPeriodRange(current, CAIRO);
    expect(previous).toEqual({ key: "thisMonth", from: "2026-02-01", to: "2026-02-15" });
  });

  it("crosses a year boundary correctly for January", () => {
    const januaryNow = new Date("2026-01-10T12:00:00Z");
    const current = dashboardPeriodRange("thisMonth", januaryNow, CAIRO);
    const previous = previousDashboardPeriodRange(current, CAIRO);
    expect(previous).toEqual({ key: "thisMonth", from: "2025-12-01", to: "2025-12-10" });
  });

  it("compares thisQuarter against the previous quarter, same depth into it", () => {
    const current = dashboardPeriodRange("thisQuarter", NOW, CAIRO); // Q1: 2026-01-01..03-15
    const previous = previousDashboardPeriodRange(current, CAIRO);
    expect(previous.key).toBe("thisQuarter");
    expect(previous.from).toBe("2025-10-01");
  });

  it("shifts a custom window back by its own length", () => {
    const current = dashboardPeriodRange("custom", NOW, CAIRO, { from: "2026-01-11", to: "2026-01-20" }); // 10 days
    const previous = previousDashboardPeriodRange(current, CAIRO);
    expect(previous).toEqual({ key: "custom", from: "2026-01-01", to: "2026-01-10" });
  });
});
