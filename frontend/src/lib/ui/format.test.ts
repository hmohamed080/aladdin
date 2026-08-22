import { describe, expect, it } from "vitest";
import {
  EMPTY,
  formatCompactMoney,
  formatCount,
  formatDate,
  formatDateTime,
  formatIdentifier,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatRelativeTime,
  formatTime,
  localeTag,
} from "./format";

/**
 * These tests exist because of a real defect, not for coverage: the Arabic
 * workspace was rendering ordinary business numbers in Latin digits, and it did
 * so INCONSISTENTLY — one panel in ١٢٣, the next in 123 — because some values
 * reached the DOM through `Intl` and others through plain string coercion.
 *
 * So the assertions are about DIGITS, deliberately. They do not pin the grouping
 * separator, the currency symbol, the month name or the bidi control characters
 * ICU emits, because those legitimately differ between ICU versions and pinning
 * them would make this suite break on a Node upgrade for no user-visible reason.
 * What must never drift is which numeral system a reader sees.
 */

const ARABIC_INDIC = /[٠-٩]/;
const WESTERN = /[0-9]/;

/** Every Arabic-Indic digit, so a spot check cannot pass on a lucky substring. */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

describe("localeTag", () => {
  it("pins the Arabic numbering system in the tag itself", () => {
    // The whole fix rests on this: `ar-EG` alone lets the runtime's ICU choose,
    // and different runtimes choose differently.
    expect(localeTag("ar")).toBe("ar-EG-u-nu-arab");
    expect(localeTag("en")).toBe("en-EG");
  });
});

describe("formatNumber — Arabic", () => {
  it("renders 1234567890 entirely in Arabic-Indic digits", () => {
    const out = formatNumber(1234567890, "ar");
    expect(out).not.toMatch(WESTERN);
    // Each of the ten digits appears somewhere in 1234567890 (plus a 0), so the
    // whole numeral set is exercised by one value.
    for (const d of AR_DIGITS) expect(out).toContain(d);
  });

  it("keeps counts, quantities and decimals in the same numeral system", () => {
    expect(formatCount(12, "ar")).not.toMatch(WESTERN);
    expect(formatCount(12, "ar")).toMatch(ARABIC_INDIC);
    expect(formatQuantity("12.50", "ar")).not.toMatch(WESTERN);
    expect(formatNumber(0, "ar")).toBe("٠");
  });

  it("rounds a count rather than printing 12.5 orders", () => {
    expect(formatCount(12.6, "en")).toBe("13");
  });
});

describe("formatNumber — English", () => {
  it("stays on Western digits", () => {
    const out = formatNumber(1234567890, "en");
    expect(out).not.toMatch(ARABIC_INDIC);
    expect(out).toContain("1");
    expect(out).toContain("234");
    expect(formatCount(12, "en")).toBe("12");
  });
});

describe("currency", () => {
  it("renders EGP money in Arabic-Indic digits for Arabic", () => {
    const out = formatMoney(560000, "ar");
    expect(out).not.toMatch(WESTERN);
    expect(out).toMatch(ARABIC_INDIC);
  });

  it("renders EGP money in Western digits for English", () => {
    const out = formatMoney(560000, "en");
    expect(out).not.toMatch(ARABIC_INDIC);
    expect(out).toContain("560,000");
  });

  it("shortens a large figure for tiles and axes, in both numeral systems", () => {
    expect(formatCompactMoney(1_100_000, "en")).not.toMatch(ARABIC_INDIC);
    expect(formatCompactMoney(1_100_000, "ar")).not.toMatch(WESTERN);
  });

  it("shows the shared dash for an absent or unparseable figure", () => {
    expect(formatMoney(null, "ar")).toBe(EMPTY);
    expect(formatMoney("not-a-number", "en")).toBe(EMPTY);
    expect(formatCompactMoney(undefined, "ar")).toBe(EMPTY);
  });
});

describe("percentages", () => {
  it("takes 0–100 and renders 18% in the reader's numerals", () => {
    expect(formatPercent(18, "en")).toContain("18");
    expect(formatPercent(18, "en")).not.toMatch(ARABIC_INDIC);

    const ar = formatPercent(18, "ar");
    expect(ar).not.toMatch(WESTERN);
    expect(ar).toContain("١٨");
  });
});

describe("dates and times", () => {
  const iso = "2026-08-15T14:30:00.000Z";

  it("renders 15 August 2026 in Arabic-Indic digits for Arabic", () => {
    const out = formatDate(iso, "ar");
    expect(out).not.toMatch(WESTERN);
    expect(out).toContain("١٥"); // day
    expect(out).toContain("٢٠٢٦"); // year
  });

  it("renders the same date in Western digits for English", () => {
    const out = formatDate(iso, "en");
    expect(out).not.toMatch(ARABIC_INDIC);
    expect(out).toContain("15");
    expect(out).toContain("2026");
  });

  it("stays Gregorian in Arabic rather than falling back to a Hijri default", () => {
    // A delivery date is a Gregorian business date in both locales; only the
    // digits and the month name change.
    expect(formatDate(iso, "ar")).toContain("٢٠٢٦");
  });

  it("carries the numeral system through date-times, clock times and month labels", () => {
    expect(formatDateTime(iso, "ar")).not.toMatch(WESTERN);
    expect(formatTime(iso, "ar")).not.toMatch(WESTERN);
    expect(formatMonth("2026-03", "ar")).not.toMatch(WESTERN);
    expect(formatDateTime(iso, "en")).not.toMatch(ARABIC_INDIC);
  });

  it("returns the dash for a missing or unparseable instant", () => {
    expect(formatDate(null, "ar")).toBe(EMPTY);
    expect(formatDate("nonsense", "en")).toBe(EMPTY);
    expect(formatMonth("not-a-month", "en")).toBe("not-a-month");
  });
});

describe("relative time", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("renders a relative distance in each locale's own numerals", () => {
    const past = "2026-08-12T12:00:00.000Z";
    expect(formatRelativeTime(past, "ar", now)).not.toMatch(WESTERN);
    expect(formatRelativeTime(past, "en", now)).not.toMatch(ARABIC_INDIC);
    expect(formatRelativeTime(past, "en", now)).toContain("3 days ago");
  });

  it("handles a future instant", () => {
    expect(formatRelativeTime("2026-08-20T12:00:00.000Z", "en", now)).toContain("5 days");
  });
});

describe("technical identifiers — the exception", () => {
  it("leaves an order reference in Latin, in Arabic too", () => {
    // ORD-1256 is looked up and dictated; reshaping its digits would produce a
    // reference that does not match the record it names.
    expect(formatIdentifier("ORD-1256")).toBe("ORD-1256");
    expect(formatIdentifier("ORD-1256")).not.toMatch(ARABIC_INDIC);
  });

  it("leaves SKUs, UUIDs, emails and URLs untouched", () => {
    const cases = [
      "SKU-4471-B",
      "6a63f096-3971-434a-be0b-4715f3f86307",
      "rania@example.test",
      "https://aladdin.test/b2b/orders/12",
    ];
    for (const c of cases) {
      expect(formatIdentifier(c)).toBe(c);
      expect(formatIdentifier(c)).not.toMatch(ARABIC_INDIC);
    }
  });

  it("shows the dash for an absent identifier, like every other formatter", () => {
    expect(formatIdentifier(null)).toBe(EMPTY);
    expect(formatIdentifier("")).toBe(EMPTY);
  });
});
