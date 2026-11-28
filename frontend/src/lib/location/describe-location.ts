import { GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { businessCitiesOf } from "@/lib/location/business-location";

/** A stored branch location: canonical governorate key, plus a catalogue city key OR a typed city. */
export type BranchLocationValue = { governorate: string | null; city: string | null; cityCustomName: string | null };

/** Display text for a stored location ("Cairo - Maadi"), or null when none was ever set. */
export function describeLocation(value: BranchLocationValue | undefined, locale: string): string | null {
  const gov = GOVERNORATE_OPTIONS.find((g) => g.value === value?.governorate);
  if (!value || !gov) return null;
  const pick = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const catalogueCity = value.city ? businessCitiesOf(value.governorate).find((c) => c.value === value.city) : undefined;
  const city = value.cityCustomName ?? (catalogueCity ? pick(catalogueCity) : null);
  return city ? `${pick(gov)} - ${city}` : pick(gov);
}
