import type { MapsConfig } from "@/lib/env/maps";
import { EGYPT_BOUNDS } from "./address-model";
import { searchPlaces } from "./place-search";

/**
 * The map provider seam of buyer addresses. The form depends on THIS file, never on Google directly, so the choice of provider
 * (and its billing) can change without touching the form, and the form works with no provider at all.
 *
 * - provider "none": the place catalogue search + manual street/building entry + optional coordinates (the fallback).
 * - provider "google": adds Places autocomplete (landmarks, streets) and a draggable pin. Loaded lazily, only when the form is
 *   opened and only with a well-formed browser key (lib/env/maps.ts). One script load per page; each search is debounced and needs
 *   at least 3 characters so the quota is spent on real searches (docs/security/MARKETPLACE_ADDRESSES_PHONE.md).
 *
 * NOT verified against the live Google service: no key or billing account exists yet. What is tested here is the pure part: the
 * script URL, the loader's single-flight and failure behaviour, and mapping Google's address components onto catalogue keys.
 */

export type LatLng = { lat: number; lng: number };

export function isInsideEgypt(p: LatLng): boolean {
  return p.lat >= EGYPT_BOUNDS.latMin && p.lat <= EGYPT_BOUNDS.latMax && p.lng >= EGYPT_BOUNDS.lngMin && p.lng <= EGYPT_BOUNDS.lngMax;
}

/** Cairo, where the map opens when nothing is chosen yet. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 30.0444, lng: 31.2357 };

export function googleScriptUrl(apiKey: string, locale: "ar" | "en"): string {
  const q = new URLSearchParams({ key: apiKey, libraries: "places", language: locale, region: "EG", loading: "async", v: "weekly" });
  return `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
}

/** The minimum of the Google Maps JS surface this app touches; typed here so no `@types/google.maps` dependency is needed. */
export type GoogleMapsApi = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => { setCenter(p: LatLng): void; addListener(ev: string, fn: (e: { latLng?: { lat(): number; lng(): number } }) => void): void };
    Marker: new (opts: Record<string, unknown>) => { setPosition(p: LatLng): void; setVisible(v: boolean): void; getPosition(): { lat(): number; lng(): number } | null; addListener(ev: string, fn: () => void): void };
    places: {
      AutocompleteService: new () => {
        getPlacePredictions(
          req: { input: string; componentRestrictions: { country: string }; language: string },
          cb: (r: Array<{ description: string; place_id: string }> | null, status: string) => void,
        ): void;
      };
      PlacesService: new (el: HTMLElement) => {
        getDetails(
          req: { placeId: string; fields: string[] },
          cb: (r: { geometry?: { location?: { lat(): number; lng(): number } }; address_components?: Array<{ long_name: string; types: string[] }> } | null, status: string) => void,
        ): void;
      };
    };
  };
};

type Loader = { appendScript(url: string, onload: () => void, onerror: () => void): void; read(): GoogleMapsApi | undefined };

let inflight: Promise<GoogleMapsApi> | null = null;

/**
 * Loads Google Maps once. A failure clears the cache so a later attempt can retry, and rejects with a plain error that carries no key.
 * `deps` is injectable for tests; in the browser it appends one <script> tag.
 */
export function loadGoogleMaps(config: Extract<MapsConfig, { provider: "google" }>, locale: "ar" | "en", deps?: Loader): Promise<GoogleMapsApi> {
  const loader: Loader = deps ?? {
    appendScript(url, onload, onerror) {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = onload;
      s.onerror = onerror;
      document.head.appendChild(s);
    },
    read: () => (globalThis as unknown as { google?: GoogleMapsApi }).google,
  };
  const ready = loader.read();
  if (ready?.maps?.places) return Promise.resolve(ready);
  if (inflight) return inflight;
  const attempt = new Promise<GoogleMapsApi>((resolve, reject) => {
    loader.appendScript(
      googleScriptUrl(config.apiKey, locale),
      () => {
        const api = loader.read();
        if (api?.maps?.places) resolve(api);
        else reject(new Error("maps unavailable"));
      },
      () => reject(new Error("maps unavailable")),
    );
  });
  inflight = attempt;
  // a failed load must not be remembered, so a later attempt can retry
  attempt.catch(() => {
    if (inflight === attempt) inflight = null;
  });
  return attempt;
}

/** Test seam: forget the cached load. */
export function resetGoogleMapsLoader(): void {
  inflight = null;
}

/**
 * Maps Google's address components onto the catalogue keys showrooms deliver to: the best governorate match among the
 * administrative levels, and the best area match among the finer ones. Anything it cannot place stays empty (the buyer
 * picks the governorate and area from the lists, which are always shown).
 */
export function placeFromGoogleComponents(components: Array<{ long_name: string; types: string[] }>): { gov: string | null; area: string | null } {
  let gov: string | null = null;
  let area: { key: string; gov: string } | null = null;
  const fine = ["sublocality", "sublocality_level_1", "neighborhood", "locality", "administrative_area_level_2"];
  for (const c of components) {
    // Google names a governorate "Cairo Governorate" / "محافظة القاهرة"; the catalogue holds the bare name
    const best = searchPlaces(c.long_name.replace(/\bgovernorate\b/i, "").replace(/^\s*محافظة\s*/, ""), 1)[0];
    if (!best || best.score < 70) continue;
    if (best.area && !area && c.types.some((t) => fine.includes(t))) area = { key: best.area, gov: best.gov };
    else if (!best.area && c.types.includes("administrative_area_level_1")) gov = best.gov;
  }
  // an area only counts inside its own governorate
  if (area && gov && area.gov !== gov) area = null;
  return { gov: gov ?? area?.gov ?? null, area: area?.key ?? null };
}

export type GooglePrediction = { id: string; text: string };

/** Autocomplete restricted to Egypt. Resolves to [] on any non-OK status; never rejects and never exposes the key. */
export function predictPlaces(api: GoogleMapsApi, input: string, locale: "ar" | "en"): Promise<GooglePrediction[]> {
  return new Promise((resolve) => {
    new api.maps.places.AutocompleteService().getPlacePredictions({ input, componentRestrictions: { country: "eg" }, language: locale }, (r, status) =>
      resolve(status === "OK" && r ? r.slice(0, 5).map((p) => ({ id: p.place_id, text: p.description })) : []),
    );
  });
}

/** The pin and the catalogue place of one prediction; a pin outside Egypt is dropped. */
export function placeDetails(api: GoogleMapsApi, placeId: string): Promise<{ pin: LatLng | null; gov: string | null; area: string | null }> {
  return new Promise((resolve) => {
    new api.maps.places.PlacesService(document.createElement("div")).getDetails({ placeId, fields: ["geometry", "address_components"] }, (r, status) => {
      if (status !== "OK" || !r) return resolve({ pin: null, gov: null, area: null });
      const loc = r.geometry?.location;
      const pin = loc ? { lat: loc.lat(), lng: loc.lng() } : null;
      resolve({ pin: pin && isInsideEgypt(pin) ? pin : null, ...placeFromGoogleComponents(r.address_components ?? []) });
    });
  });
}
