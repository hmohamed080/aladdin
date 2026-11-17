import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";

type L = "ar" | "en";
const pick = (o: { ar: string; en: string } | undefined, locale: L, fallback: string) => (o ? o[locale] : fallback);

/** A governorate's name in the shown language (the key itself if the catalogue does not know it). */
export function governorateName(key: string, locale: L): string {
  return pick(GOVERNORATE_OPTIONS.find((g) => g.value === key), locale, key);
}

/** An area's name inside its governorate. */
export function areaName(governorate: string, key: string, locale: L): string {
  return pick((CITIES_BY_GOVERNORATE[governorate] ?? []).find((c) => c.value === key), locale, key);
}

/** "Cairo (All areas)" for a whole governorate, "Cairo — Maadi" for one area. */
export function placeLabel(governorate: string, area: string, locale: L, allAreas: string): string {
  const g = governorateName(governorate, locale);
  return area ? `${g} — ${areaName(governorate, area, locale)}` : `${g} (${allAreas})`;
}
