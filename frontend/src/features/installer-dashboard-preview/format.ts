import type { Locale } from "@/lib/i18n/locales";
import { localeTag } from "@/lib/ui/format";

/**
 * Whole-EGP money, no piastres.
 *
 * The shared `formatMoney` in `@/lib/ui/format` always carries two decimal
 * places (`Intl.NumberFormat`'s default minor-unit precision for a currency),
 * which is correct where a real fractional amount can occur but reads as
 * noise on this dashboard's demo figures — every job payment, reward value
 * and points-adjacent EGP amount here is authored as a whole number. A local
 * formatter with `maximumFractionDigits: 0` is scoped to this preview rather
 * than changing the shared utility's default for the rest of the product.
 */
const wholeEgpFormats = new Map<string, Intl.NumberFormat>();

export function formatWholeEGP(value: number, locale: Locale): string {
  const tag = localeTag(locale);
  let f = wholeEgpFormats.get(tag);
  if (!f) {
    f = new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "EGP",
      maximumFractionDigits: 0,
    });
    wholeEgpFormats.set(tag, f);
  }
  return f.format(value);
}
