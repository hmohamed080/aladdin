import { describe, expect, it } from "vitest";

import { PERIOD_DAYS, periodDays, resolvePeriod } from "./period";

describe("resolvePeriod treats the URL as untrusted input", () => {
  it("accepts every period it offers", () => {
    for (const key of ["30d", "90d", "365d", "all"] as const) {
      expect(resolvePeriod(key)).toBe(key);
    }
  });

  it("falls back rather than passing anything through", () => {
    // A dashboard that accepted `?period=` verbatim would hand an arbitrary
    // string to the query layer as a window length.
    expect(resolvePeriod(undefined)).toBe("30d");
    expect(resolvePeriod("")).toBe("30d");
    expect(resolvePeriod("7d")).toBe("30d");
    expect(resolvePeriod("../../etc/passwd")).toBe("30d");
    expect(resolvePeriod("__proto__")).toBe("30d");
  });

  it("lets a caller name its own default", () => {
    expect(resolvePeriod("nonsense", "90d")).toBe("90d");
  });
});

describe("periodDays", () => {
  it("maps each window to its length", () => {
    expect(periodDays("30d")).toBe(30);
    expect(periodDays("90d")).toBe(90);
    expect(periodDays("365d")).toBe(365);
  });

  it("gives 'all time' no window, which is what suppresses the comparison", () => {
    // `supplySummary(…, compareDays)` computes a previous window only when it is
    // given one. All time has no period before it, so a delta would be a lie.
    expect(periodDays("all")).toBeUndefined();
  });

  it("keeps the day table and the resolver in agreement", () => {
    for (const key of Object.keys(PERIOD_DAYS) as (keyof typeof PERIOD_DAYS)[]) {
      expect(resolvePeriod(key)).toBe(key);
      expect(periodDays(key)).toBe(PERIOD_DAYS[key]);
    }
  });
});
