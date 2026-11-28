import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY,
  displayDayKey,
  formatCompactMoney,
  formatCompactMoneyFine,
  formatAdminDate,
  formatAdminDateTime,
  formatCount,
  formatDate,
  formatDateShort,
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

  it("formats compact money identically in every runtime (no leading direction mark, no padded zeros)", () => {
    // Cloudflare Workers' ICU adds U+200F before Arabic thousands; Node pads "7.0" without an explicit minimum.
    expect(formatCompactMoney(565_500, "ar")).toBe("٥٦٥٫٥\u00a0ألف\u00a0ج.م.\u200f");
    expect(formatCompactMoney(7, "ar")).toBe("٧\u00a0ج.م.\u200f");
    expect(formatCompactMoney(-2_500, "ar")).toBe("\u061c-٢٫٥\u00a0ألف\u00a0ج.م.\u200f");
    expect(formatCompactMoney(7, "en")).toBe("EGP\u00a07");
    expect(formatCompactMoney(1_100_000, "en")).toBe("EGP\u00a01.1M");
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

describe("formatCompactMoneyFine", () => {
  it("keeps one decimal in Arabic so 148,700 is not shown as 149 thousand", () => {
    const out = formatCompactMoneyFine(148_700, "ar");
    expect(out).toContain("١٤٨٫٧");
    expect(out).toContain("ألف");
    expect(out).not.toMatch(WESTERN);
  });
  it("handles millions, small values and empties", () => {
    expect(formatCompactMoneyFine(1_250_000, "ar")).toContain("مليون");
    expect(formatCompactMoneyFine(950, "ar")).toContain("ج.م");
    expect(formatCompactMoneyFine(null, "ar")).toBe(formatCompactMoney(null, "ar"));
  });
  it("delegates English to the standard compact format", () => {
    expect(formatCompactMoneyFine(148_700, "en")).toBe(formatCompactMoney(148_700, "en"));
  });
});

describe("formatAdminDate / formatAdminDateTime (Admin date standard)", () => {
  // 14:05:07 on 9 Sep 2026 in Cairo (UTC+3 under Egyptian summer time) — the display zone, whatever the machine's.
  const iso = "2026-09-09T11:05:07Z";

  it("is day/month/year in English, never month-first", () => {
    expect(formatAdminDate(iso, "en")).toBe("09/09/2026");
    expect(formatAdminDate("2026-09-18T22:00:00Z", "en")).toBe("19/09/2026");
  });

  it("adds a 24-hour clock with seconds: DD/MM/YYYY HH:mm:ss", () => {
    expect(formatAdminDateTime(iso, "en")).toBe("09/09/2026 14:05:07");
    // Winter time (UTC+2).
    expect(formatAdminDateTime("2026-01-02T01:04:05Z", "en")).toBe("02/01/2026 03:04:05");
  });

  it("uses Arabic-Indic digits in Arabic and keeps the same field order", () => {
    expect(formatAdminDateTime(iso, "ar")).toBe("٠٩/٠٩/٢٠٢٦ ١٤:٠٥:٠٧");
  });

  it("renders the empty marker for a missing or invalid date", () => {
    expect(formatAdminDateTime(null, "en")).toBe(formatAdminDate(null, "en"));
    expect(formatAdminDateTime("not a date", "en")).toBe(formatAdminDate("not a date", "en"));
  });
});

describe("dates do not depend on the runtime's own time zone (hydration error 418)", () => {
  // The server renders in UTC and the browser hydrates in Africa/Cairo. Any formatter that read the runtime zone
  // printed different text on the two renders, which React reports as a hydration mismatch.
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  function render(): string[] {
    // 22:30 UTC is already the NEXT day in Cairo — the instant that made date-only values drift too.
    const instant = "2026-09-19T22:30:00Z";
    return (["en", "ar"] as const).flatMap((locale) => [
      formatDate(instant, locale),
      formatDateShort(instant, locale),
      formatDateTime(instant, locale),
      formatTime(instant, locale),
      formatAdminDate(instant, locale),
      formatAdminDateTime(instant, locale),
    ]);
  }

  it("prints the same text under a UTC server and a Cairo browser", () => {
    process.env.TZ = "UTC";
    const server = render();
    process.env.TZ = "Africa/Cairo";
    const browser = render();
    process.env.TZ = "America/Los_Angeles";
    expect(browser).toEqual(server);
    expect(render()).toEqual(server);
  });

  it("shows Egypt wall-clock time", () => {
    process.env.TZ = "UTC";
    expect(formatTime("2026-09-19T22:30:00Z", "en")).toMatch(/^01:30/);
    expect(formatDate("2026-09-19T22:30:00Z", "en")).toContain("20");
    expect(displayDayKey(new Date("2026-09-19T22:30:00Z"))).toBe("2026-09-20");
    expect(displayDayKey(new Date("2026-09-19T20:30:00Z"))).toBe("2026-09-19");
  });
});
