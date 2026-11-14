import type { Locale } from "@/lib/i18n/locales";

export type LandingStats = { users: number | null; organizations: number | null; products: number | null };

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** "1,250" → "1.2K+" style is avoided: exact below 1,000, otherwise the count floored to thousands, with the locale's word for thousand. */
export function formatStat(n: number, locale: Locale): string {
  if (n < 1000) return `${n}`;
  const k = Math.floor(n / 1000);
  return locale === "ar" ? `+${k} ألف` : `+${k}K`;
}

export function toLocaleDigits(text: string, locale: Locale): string {
  return locale === "ar" ? text.replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d) : text;
}
