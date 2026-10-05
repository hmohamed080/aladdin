import type { Locale } from "@/lib/i18n/locales";

/** A bilingual string pair. The product is Arabic-first; English is a first-class switch — never a string that only exists in one. */
export type Bi = { ar: string; en: string };

export function pick(locale: Locale, bi: Bi): string {
  return locale === "ar" ? bi.ar : bi.en;
}
