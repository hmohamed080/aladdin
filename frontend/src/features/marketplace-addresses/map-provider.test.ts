import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAP_CENTER, googleScriptUrl, isInsideEgypt, loadGoogleMaps, placeFromGoogleComponents, resetGoogleMapsLoader, type GoogleMapsApi } from "./map-provider";

const CONFIG = { provider: "google", apiKey: "AIzaSyExampleExampleExampleExample123" } as const;
const api = { maps: { places: {} } } as unknown as GoogleMapsApi;

beforeEach(() => resetGoogleMapsLoader());

describe("google script url", () => {
  it("restricts to Egypt, carries the language and loads places", () => {
    const u = new URL(googleScriptUrl("KEY", "ar"));
    expect(u.origin + u.pathname).toBe("https://maps.googleapis.com/maps/api/js");
    expect(u.searchParams.get("language")).toBe("ar");
    expect(u.searchParams.get("region")).toBe("EG");
    expect(u.searchParams.get("libraries")).toBe("places");
  });
});

describe("pin bounds", () => {
  it("accepts Egypt and refuses elsewhere; the default centre is inside", () => {
    expect(isInsideEgypt({ lat: 30.04, lng: 31.23 })).toBe(true);
    expect(isInsideEgypt({ lat: 48.85, lng: 2.35 })).toBe(false);
    expect(isInsideEgypt(DEFAULT_MAP_CENTER)).toBe(true);
  });
});

describe("loadGoogleMaps", () => {
  it("loads once however many callers ask", async () => {
    let loaded: GoogleMapsApi | undefined;
    const appendScript = vi.fn((_url: string, onload: () => void) => {
      loaded = api;
      onload();
    });
    const loader = { appendScript, read: () => loaded };
    const [a, b] = await Promise.all([loadGoogleMaps(CONFIG, "en", loader), loadGoogleMaps(CONFIG, "en", loader)]);
    expect(a).toBe(api);
    expect(b).toBe(api);
    expect(appendScript).toHaveBeenCalledTimes(1);
    // already present: no second script at all
    await loadGoogleMaps(CONFIG, "en", loader);
    expect(appendScript).toHaveBeenCalledTimes(1);
  });

  it("rejects without the key and can be retried after a failure", async () => {
    const failing = { appendScript: (_u: string, _ok: () => void, onerror: () => void) => onerror(), read: () => undefined };
    await expect(loadGoogleMaps(CONFIG, "en", failing)).rejects.toThrow("maps unavailable");
    await expect(loadGoogleMaps(CONFIG, "en", failing)).rejects.toThrow(/^maps unavailable$/);
    let loaded: GoogleMapsApi | undefined;
    const working = { appendScript: (_u: string, ok: () => void) => { loaded = api; ok(); }, read: () => loaded };
    await expect(loadGoogleMaps(CONFIG, "en", working)).resolves.toBe(api);
  });

  it("treats a script that loads without the places library as a failure", async () => {
    const empty = { appendScript: (_u: string, ok: () => void) => ok(), read: () => undefined };
    await expect(loadGoogleMaps(CONFIG, "en", empty)).rejects.toThrow("maps unavailable");
  });
});

describe("placeFromGoogleComponents", () => {
  it("maps a neighbourhood and a governorate onto catalogue keys", () => {
    expect(
      placeFromGoogleComponents([
        { long_name: "Maadi", types: ["sublocality", "sublocality_level_1"] },
        { long_name: "Cairo Governorate", types: ["administrative_area_level_1"] },
      ]),
    ).toEqual({ gov: "cairo", area: "maadi" });
  });

  it("drops an area that does not belong to the governorate it came with", () => {
    expect(
      placeFromGoogleComponents([
        { long_name: "Maadi", types: ["sublocality"] },
        { long_name: "Giza", types: ["administrative_area_level_1"] },
      ]),
    ).toEqual({ gov: "giza", area: null });
  });

  it("leaves what it cannot place empty", () => {
    expect(placeFromGoogleComponents([{ long_name: "Somewhere Unknown", types: ["locality"] }])).toEqual({ gov: null, area: null });
  });
});
