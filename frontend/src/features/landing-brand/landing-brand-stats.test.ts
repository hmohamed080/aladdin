import { describe, expect, it } from "vitest";
import { formatStat } from "./landing-brand-stats";

describe("landing stats formatting", () => {
  it("shows exact counts below 1,000 and never invents a plus sign", () => {
    expect(formatStat(7)).toBe("7");
    expect(formatStat(999)).toBe("999");
  });
  it("floors to thousands, never rounding up to a number that is not true", () => {
    expect(formatStat(1999)).toBe("+1,900");
    expect(formatStat(4_850)).toBe("+4,800");
    expect(formatStat(12_999)).toBe("+12 ألف");
    expect(formatStat(250_400)).toBe("+250 ألف");
  });
});
