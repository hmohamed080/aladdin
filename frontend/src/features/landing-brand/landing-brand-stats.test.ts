import { describe, expect, it } from "vitest";
import { formatStat, toLocaleDigits } from "./landing-brand-stats";

describe("landing stats formatting", () => {
  it("shows exact counts below 1,000 and never invents a plus sign", () => {
    expect(formatStat(7, "en")).toBe("7");
    expect(formatStat(999, "ar")).toBe("999");
  });
  it("floors to thousands, never rounding up to a number that is not true", () => {
    expect(formatStat(1999, "en")).toBe("+1K");
    expect(formatStat(250_400, "ar")).toBe("+250 ألف");
  });
  it("uses Arabic-Indic digits only for Arabic", () => {
    expect(toLocaleDigits("+250 ألف", "ar")).toBe("+٢٥٠ ألف");
    expect(toLocaleDigits("+250K", "en")).toBe("+250K");
  });
});
