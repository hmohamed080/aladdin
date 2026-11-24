"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import type { MapsConfig } from "@/lib/env/maps";
import { useI18n } from "@/lib/i18n/context";
import { requestDeviceLocation } from "./device-location";
import { DEFAULT_MAP_CENTER, isInsideEgypt, loadGoogleMaps } from "./map-provider";

/**
 * The map pin of an address, behind the provider seam (map-provider.ts).
 * - no provider configured: two optional coordinate fields (the manual fallback; the address is fully valid without them);
 * - Google configured: a map with a draggable pin, loaded only when this component is shown. If the map cannot load, the form
 *   falls back to the coordinate fields and says so.
 * The value is two strings (empty = no pin) so a half-typed number is never lost.
 */
export function PinPicker({
  config,
  lat,
  lng,
  onChange,
}: {
  config: MapsConfig;
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string, source?: "device" | "map") => void;
}) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const useMap = config.provider === "google" && !failed;
  const hasPin = lat !== "" && lng !== "";

  async function share() {
    setLocating(true);
    setLocationError(null);
    const r = await requestDeviceLocation();
    setLocating(false);
    if (r.ok) onChange(r.lat, r.lng, "device");
    else setLocationError(`buyerAddresses.form.location.${r.reason}`);
  }

  return (
    <fieldset className="flex flex-col gap-sm" data-testid="pin-picker">
      <legend className="text-label font-medium text-fg-secondary">{t("buyerAddresses.form.pinTitle")}</legend>
      {config.provider === "google" && failed ? <InlineError>{t("buyerAddresses.form.mapFailed")}</InlineError> : null}
      {useMap ? (
        <GoogleMapPin config={config} locale={locale} lat={lat} lng={lng} onChange={onChange} onFail={() => setFailed(true)} />
      ) : (
        <>
          <p className="text-label text-fg-muted">{t("buyerAddresses.form.locationHint")}</p>
          <div>
            <Button variant="outline" size="sm" disabled={locating} onClick={share} data-testid="share-location">
              {locating ? t("buyerAddresses.form.locating") : t("buyerAddresses.form.useMyLocation")}
            </Button>
          </div>
          {locationError ? <InlineError>{t(locationError)}</InlineError> : null}
        </>
      )}
      {hasPin ? (
        <div className="flex items-center gap-sm">
          <span className="text-label text-success">{t("buyerAddresses.form.pinSet")}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange("", "")}>
            {t("buyerAddresses.form.pinClear")}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

function GoogleMapPin({
  config,
  locale,
  lat,
  lng,
  onChange,
  onFail,
}: {
  config: Extract<MapsConfig, { provider: "google" }>;
  locale: "ar" | "en";
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
  onFail: () => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(config, locale)
      .then((api) => {
        if (cancelled || !host.current) return;
        const start = lat && lng ? { lat: Number(lat), lng: Number(lng) } : DEFAULT_MAP_CENTER;
        const map = new api.maps.Map(host.current, { center: start, zoom: lat && lng ? 16 : 11, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative" });
        const marker = new api.maps.Marker({ map, position: start, draggable: true, visible: !!(lat && lng) });
        const set = (p: { lat: number; lng: number }) => {
          if (isInsideEgypt(p)) onChangeRef.current(p.lat.toFixed(6), p.lng.toFixed(6));
        };
        map.addListener("click", (e) => {
          if (!e.latLng) return;
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          marker.setPosition(p);
          set(p);
        });
        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (pos) set({ lat: pos.lat(), lng: pos.lng() });
        });
      })
      .catch(() => {
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
    };
    // the map is built once; later pin changes are pushed to the marker below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiKey, locale]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={host} className="h-64 w-full rounded-md border bg-surface" data-testid="google-map" />
      <p className="text-label text-fg-muted">{t("buyerAddresses.form.mapHint")}</p>
    </div>
  );
}
