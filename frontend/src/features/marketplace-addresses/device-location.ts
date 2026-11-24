import { isInsideEgypt } from "./map-provider";

/**
 * "Use my current location": the browser's own Geolocation API, nothing else. No map key, no third-party request, no reverse
 * geocoding (so it cannot name a governorate or area; the buyer still picks those). The browser asks the person for permission;
 * this file only translates the outcome. Coordinates are personal data: they are returned to the caller's form state, rounded to
 * six decimals (about 0.1 m), and are never logged or placed in a URL here.
 */
export type DeviceLocationResult =
  | { ok: true; lat: string; lng: string }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" | "timeout" | "outside_egypt" };

type GeoLike = Pick<Geolocation, "getCurrentPosition">;

export function requestDeviceLocation(geo: GeoLike | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation): Promise<DeviceLocationResult> {
  return new Promise((resolve) => {
    if (!geo) return resolve({ ok: false, reason: "unsupported" });
    geo.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return resolve({ ok: false, reason: "unavailable" });
        if (!isInsideEgypt(p)) return resolve({ ok: false, reason: "outside_egypt" });
        resolve({ ok: true, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
      },
      (err) => resolve({ ok: false, reason: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  });
}
