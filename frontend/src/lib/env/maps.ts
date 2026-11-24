/**
 * Public configuration of the map provider behind buyer addresses (Marketplace PR 10).
 *
 * - NEXT_PUBLIC_MAPS_PROVIDER: "google" turns the Google Maps pin picker and Places search on; anything else, a typo or a missing
 *   value means "none" (the address form stays fully usable with the Egypt place catalogue and manual entry).
 * - NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: the BROWSER key. It is public by design (it ships in the page), so it is only safe when it is
 *   restricted in Google Cloud to the site's HTTP referrers and to the Maps JavaScript + Places APIs, with a budget alert and per-API
 *   quotas set first (docs/security/MARKETPLACE_ADDRESSES_PHONE.md, section "Google Maps budget"). A server/geocoding key must never
 *   be put here.
 *
 * Without a well-formed key the provider is "none" even when the switch says "google": the app never loads Google's script
 * with a half-configured key. This is the only place that reads these variables (literal `process.env.NEXT_PUBLIC_*` accesses,
 * which is what lets Next inline them into the client bundle). It never throws, so Client Components can call it.
 */
export type MapsConfig = { provider: "none" } | { provider: "google"; apiKey: string };

const GOOGLE_BROWSER_KEY = /^[A-Za-z0-9_-]{20,128}$/;

export function parseMapsConfig(source: { provider: string | undefined; googleKey: string | undefined }): MapsConfig {
  const key = source.googleKey?.trim();
  if (source.provider?.trim() === "google" && key && GOOGLE_BROWSER_KEY.test(key)) return { provider: "google", apiKey: key };
  return { provider: "none" };
}

export function readMapsConfig(): MapsConfig {
  return parseMapsConfig({
    provider: process.env.NEXT_PUBLIC_MAPS_PROVIDER,
    googleKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  });
}
