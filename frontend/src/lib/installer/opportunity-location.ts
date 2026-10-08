import type { Locale } from "@/lib/i18n/locales";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS, type LocationOption } from "./location-data";

/**
 * "NEARBY" FOR AN INSTALLER, FROM WHAT THE DATA CAN ACTUALLY SUPPORT.
 *
 * Two sources describe a place, and they are NOT the same kind of value:
 *   - the installer's side is CANONICAL: `prof_governorate` is a key from the
 *     governorate catalogue, and service areas are city keys from that
 *     governorate's catalogue (chosen from a list in the profile editor);
 *   - a job's side is FREE TEXT: the poster typed `governorate` and `city` into
 *     plain inputs (`features/jobs/job-form.tsx`), so "Cairo", "القاهرة",
 *     "القاهره" and "Cairo Governorate" are four different strings.
 *
 * There are no coordinates anywhere, so there is no distance, no radius and no
 * "nearest" ranking — only two tiers, in this order:
 *   1. CITY        the job's city is one of the installer's own service cities
 *   2. GOVERNORATE the job is in the installer's governorate
 *
 * A job is matched ONLY when its text is, after lossless orthographic
 * normalisation (case, whitespace, Arabic diacritics and tatweel), exactly one
 * of the catalogue's own names for a place. Nothing is guessed: a different
 * spelling, an alternative name, or a neighbourhood typed into the city box
 * simply does not resolve, and an unresolved job is never called nearby (it is
 * still an available opportunity). That trades missed matches for never
 * claiming a match that is not there.
 */

export type LocationTier = "city" | "governorate" | "none";

export type InstallerLocation = {
  /** A catalogue governorate key. */
  governorate: string;
  /** Catalogue city keys inside that governorate the installer works in. */
  cities: ReadonlySet<string>;
};

type PlaceFields = { governorate: string | null; city: string | null };

/** Case, whitespace, Arabic diacritics (tashkeel) and tatweel — nothing that changes which letters were typed. */
export function normalizePlace(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function indexOptions(options: readonly LocationOption[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const option of options) {
    for (const name of [option.value, option.ar, option.en]) index.set(normalizePlace(name), option.value);
  }
  return index;
}

const GOVERNORATE_INDEX = indexOptions(GOVERNORATE_OPTIONS);
const CITY_INDEXES = new Map<string, Map<string, string>>(
  Object.entries(CITIES_BY_GOVERNORATE).map(([governorate, cities]) => [governorate, indexOptions(cities)]),
);

/** The catalogue key a governorate string names exactly, or null. */
export function resolveGovernorateKey(text: string | null | undefined): string | null {
  if (!text) return null;
  return GOVERNORATE_INDEX.get(normalizePlace(text)) ?? null;
}

/** The catalogue key a city string names exactly INSIDE the given governorate, or null. */
export function resolveCityKey(governorateKey: string, text: string | null | undefined): string | null {
  if (!text) return null;
  return CITY_INDEXES.get(governorateKey)?.get(normalizePlace(text)) ?? null;
}

/**
 * The installer's location, or null when they have none that the catalogue can
 * vouch for (no governorate, or one that is not a catalogue key). "Other city"
 * is not a place, so it never counts as a service city.
 */
export function installerLocationFrom(professional: {
  governorate: string | null;
  city: string | null;
  serviceAreas: readonly string[];
}): InstallerLocation | null {
  const governorate = resolveGovernorateKey(professional.governorate);
  if (!governorate) return null;
  const cities = new Set<string>();
  for (const candidate of [...professional.serviceAreas, professional.city ?? ""]) {
    const key = resolveCityKey(governorate, candidate);
    if (key && key !== "other") cities.add(key);
  }
  return { governorate, cities };
}

export function matchTier(location: InstallerLocation, job: PlaceFields): LocationTier {
  const governorate = resolveGovernorateKey(job.governorate);
  if (!governorate || governorate !== location.governorate) return "none";
  const city = resolveCityKey(governorate, job.city);
  return city && location.cities.has(city) ? "city" : "governorate";
}

const TIER_ORDER: Record<LocationTier, number> = { city: 0, governorate: 1, none: 2 };

/**
 * Orders jobs city-match first, then governorate-match, then the rest. The sort
 * is stable, so within a tier the incoming (newest-first) order is kept.
 */
export function rankByLocation<T extends PlaceFields>(jobs: readonly T[], location: InstallerLocation | null): T[] {
  if (!location) return [...jobs];
  return jobs
    .map((job, index) => ({ job, index, tier: TIER_ORDER[matchTier(location, job)] }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.job);
}

/**
 * How many of these jobs are provably nearby, or null when that cannot be said.
 *
 * Null (never 0) when the installer has no usable location, or when `complete`
 * is false — i.e. the list may be cut short by its row cap, so a count would be a
 * lower bound dressed up as a total. Jobs already applied to are not counted:
 * the figure is "opportunities you could still go for".
 */
export function countNearby<T extends PlaceFields & { has_applied?: boolean | null }>(
  jobs: readonly T[],
  location: InstallerLocation | null,
  complete: boolean,
): number | null {
  if (!location || !complete) return null;
  return jobs.filter((job) => !job.has_applied && matchTier(location, job) !== "none").length;
}

/**
 * The dashboard's opportunity feed, from the WHOLE open board.
 *
 * `jobs` must be the full result of `listJobOpportunities` (not the three cards
 * on screen). `cards` is only the first `previewLimit` after ranking; the nearby
 * COUNT is taken over every job in `jobs`, so showing three cards never limits
 * it. `listLimit` is that read's row cap: a list that reaches it may have been
 * cut off, and then the count is null ("unknown") instead of a lower bound
 * presented as a total.
 */
export function buildOpportunityFeed<T extends PlaceFields & { has_applied?: boolean | null }>(
  jobs: readonly T[],
  location: InstallerLocation | null,
  options: { previewLimit: number; listLimit: number },
): { cards: T[]; nearbyCount: number | null } {
  const complete = jobs.length < options.listLimit;
  return {
    cards: rankByLocation(jobs, location).slice(0, options.previewLimit),
    nearbyCount: countNearby(jobs, location, complete),
  };
}

function label(option: LocationOption | undefined, locale: Locale): string | null {
  return option ? (locale === "ar" ? option.ar : option.en) : null;
}

/**
 * The installer's service location as words: "City، Governorate", or just the
 * governorate. Stored values are catalogue KEYS ("new-cairo"), never what a
 * person should be shown, so known keys are labelled; anything the catalogue
 * does not know is shown exactly as stored rather than hidden.
 */
export function installerLocationLabel(
  professional: { governorate: string | null; city: string | null },
  locale: Locale,
): string | null {
  const governorateKey = resolveGovernorateKey(professional.governorate);
  const governorateText = governorateKey
    ? label(GOVERNORATE_OPTIONS.find((o) => o.value === governorateKey), locale)
    : (professional.governorate?.trim() || null);

  let cityText: string | null = null;
  if (professional.city?.trim()) {
    const cityKey = governorateKey ? resolveCityKey(governorateKey, professional.city) : null;
    cityText =
      governorateKey && cityKey
        ? label(CITIES_BY_GOVERNORATE[governorateKey]?.find((o) => o.value === cityKey), locale)
        : professional.city.trim();
  }
  const parts = [cityText, governorateText].filter(Boolean);
  return parts.length ? parts.join("، ") : null;
}

/**
 * A job's place as WORDS in the viewer's language: the catalogue's own Arabic / English names when the stored text
 * resolves exactly (it always does for a job created or edited since places became catalogue choices), and the text as
 * typed otherwise — so an old job still shows what its poster wrote, and a new one reads in the viewer's language
 * whichever language the poster used. City first, then governorate, joined with the language's own comma.
 */
export function placeLabel(locale: Locale, governorate: string | null | undefined, city: string | null | undefined): string {
  const gk = resolveGovernorateKey(governorate);
  const governorateOption = gk ? GOVERNORATE_OPTIONS.find((option) => option.value === gk) : undefined;
  const ck = gk ? resolveCityKey(gk, city) : null;
  const cityOption = gk && ck ? (CITIES_BY_GOVERNORATE[gk] ?? []).find((option) => option.value === ck) : undefined;
  const pick = (option: LocationOption) => (locale === "ar" ? option.ar : option.en);
  return [cityOption ? pick(cityOption) : city, governorateOption ? pick(governorateOption) : governorate]
    .filter(Boolean)
    .join(locale === "ar" ? "، " : ", ");
}
