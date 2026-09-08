import type { Locale } from "@/lib/i18n/locales";

/**
 * Display resolution for a FREE-TEXT bilingual field — an organization or
 * branch name/address the OWNER typed in, not a controlled vocabulary term.
 *
 * WHY THIS IS NOT THE KEY+MESSAGE-CATALOG PATTERN
 * `product_category`, `trades`, and every other bilingual value in this
 * codebase resolve through a stable machine key plus `en.ts`/`ar.ts` — correct
 * for a fixed, finite vocabulary the product itself defines. An organization's
 * trading name is neither fixed nor finite: it is the OWNER'S data, entered
 * once, and a message catalog has no entry for "Cairo Ceramics Showroom"
 * because that string belongs to one showroom, not to the product. Routing it
 * through `en.ts`/`ar.ts` would mean shipping a code change every time a
 * business registered — the `trades` migration documents exactly why that
 * pattern is wrong for this case ("would create a second translation source").
 *
 * THE RULE
 * Arabic UI prefers the Arabic value; English UI prefers the English value;
 * either falls back to the original single `name` column when its preferred
 * translation was never entered. Never auto-translated, never forced — an
 * owner who only ever typed one name sees that one name in both languages,
 * which is correct: it is still their real, entered name.
 */
export function resolveBilingualText(
  locale: Locale,
  original: string,
  ar: string | null | undefined,
  en: string | null | undefined,
): string {
  const preferred = locale === "ar" ? ar : en;
  return preferred && preferred.trim().length > 0 ? preferred : original;
}
