import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";

/**
 * Smart place search over the Egypt place catalogue (the same governorate and area keys showrooms deliver to). Works with no
 * map provider and no network: Arabic or English, tolerant of diacritics, alef/ya/ta-marbuta variants, Arabic digits, a missing
 * letter or a typo. Landmarks and street names are NOT in the catalogue; they come from the map provider when one is configured
 * (map-provider.ts), and otherwise from the street field of the form.
 */

export type PlaceSuggestion = {
  /** governorate key, and the area key when the match is an area inside it */
  gov: string;
  area: string | null;
  label: { ar: string; en: string };
  score: number;
};

const TASHKEEL = /[ً-ٰٟـ]/g;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Orthographic normalisation shared by the query and the catalogue names. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Levenshtein distance, bounded: returns max+1 as soon as the distance cannot stay within `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

type Entry = { gov: string; area: string | null; label: { ar: string; en: string }; terms: string[][] };

let entries: Entry[] | null = null;
function catalogue(): Entry[] {
  if (entries) return entries;
  const out: Entry[] = [];
  for (const g of GOVERNORATE_OPTIONS) {
    out.push({ gov: g.value, area: null, label: { ar: g.ar, en: g.en }, terms: [[normalizeSearch(g.ar)], [normalizeSearch(g.en)]] });
    for (const c of CITIES_BY_GOVERNORATE[g.value] ?? []) {
      if (c.value === "other") continue; // "Other city" is not a place a person searches for
      out.push({
        gov: g.value,
        area: c.value,
        label: { ar: `${c.ar}، ${g.ar}`, en: `${c.en}, ${g.en}` },
        // the area on its own, and the area with its governorate ("maadi cairo")
        terms: [[normalizeSearch(c.ar)], [normalizeSearch(c.en)], [normalizeSearch(`${c.ar} ${g.ar}`)], [normalizeSearch(`${c.en} ${g.en}`)]],
      });
    }
  }
  entries = out;
  return out;
}

function scoreTerm(term: string, query: string, tokens: string[]): number {
  if (term === query) return 100;
  if (term.startsWith(query)) return 85;
  const termTokens = term.split(" ");
  if (tokens.every((t) => termTokens.some((w) => w.startsWith(t)))) return 70;
  if (query.length >= 3 && term.includes(query)) return 50;
  // typo tolerance: every query token is within a small edit distance of some word of the term
  const allClose = tokens.every((t) => {
    const max = t.length <= 2 ? 0 : t.length <= 6 ? 1 : 2;
    return termTokens.some((w) => editDistance(t, w.slice(0, Math.max(t.length, 1) + max), max) <= max || editDistance(t, w, max) <= max);
  });
  return allClose ? 30 : 0;
}

/** Up to `limit` catalogue places matching the text, best first; an area ranks above its governorate on equal scores. */
export function searchPlaces(text: string, limit = 6): PlaceSuggestion[] {
  const query = normalizeSearch(text);
  if (query.length < 2) return [];
  const tokens = query.split(" ").filter(Boolean);
  const hits: PlaceSuggestion[] = [];
  for (const e of catalogue()) {
    let best = 0;
    for (const term of e.terms) best = Math.max(best, scoreTerm(term.join(" "), query, tokens));
    if (best > 0) hits.push({ gov: e.gov, area: e.area, label: e.label, score: best + (e.area ? 1 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || a.label.en.localeCompare(b.label.en)).slice(0, limit);
}
