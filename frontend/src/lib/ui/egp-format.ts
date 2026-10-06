import type { Locale } from "@/lib/i18n/locales";

/**
 * EGP money for the installer job board and My Work — EXACT, never rounded, with
 * the currency as a SUFFIX.
 *
 *   4500    -> "4,500 EGP"        (Arabic: "٤٬٥٠٠ جنيه")
 *   4500.00 -> "4,500 EGP"        (an unnecessary .00 is dropped)
 *   4500.50 -> "4,500.50 EGP"     (a real fraction keeps both decimals)
 *
 * Job amounts are `numeric(12,2)` and the poster form accepts piastres, so rounding
 * would misstate what was actually offered. The dashboard cards keep their own
 * (prefix, Intl currency) formatter in `features/installer-dashboard-preview/format.ts`;
 * aligning that style is a separate follow-up.
 */
const formats = new Map<string, Intl.NumberFormat>();

function digitsFor(value: number): 0 | 2 {
  return Number.isInteger(Math.round(value * 100) / 100) ? 0 : 2;
}

export function formatEgp(value: number, locale: Locale): string {
  const digits = digitsFor(value);
  const key = `${locale}|${digits}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formats.set(key, f);
  }
  const amount = f.format(value);
  return locale === "ar" ? `${amount} جنيه` : `${amount} EGP`;
}
