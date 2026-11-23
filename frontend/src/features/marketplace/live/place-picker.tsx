"use client";

import { Select } from "@/components/ui/controls";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import type { Locale } from "../marketplace-types";
import { deliveryCopy } from "./live-delivery-copy";
import type { BuyerPlace } from "./public-contract";
import styles from "../marketplace-v2.module.css";

/**
 * The buyer's place (governorate, then optionally an area) for the delivery estimate. It only reports a choice;
 * the page decides what to do with it (the catalog and the product page put it in the URL).
 *
 * The canonical `Select` follows the app theme, but this shell is a fixed light page, so in dark mode the control rendered
 * dark on cream (the same defect the owner listed for the cart's selects). The wrapper re-points the control's semantic
 * tokens at the shell's own palette; the real fix belongs to the foundation (reported in the PR).
 */
export function PlacePicker({ locale, place, onChange, idPrefix }: { locale: Locale; place: BuyerPlace | null; onChange: (place: BuyerPlace | null) => void; idPrefix: string }) {
  const t = deliveryCopy[locale];
  const cities = place ? (CITIES_BY_GOVERNORATE[place.gov] ?? []) : [];
  const label = (o: { ar: string; en: string }) => (locale === "ar" ? o.ar : o.en);
  return (
    <div className={styles.picker}>
      <label htmlFor={`${idPrefix}-gov`} className="sr-only">{t.deliverTo}</label>
      <Select id={`${idPrefix}-gov`} value={place?.gov ?? ""} onChange={(e) => onChange(e.target.value ? { gov: e.target.value, area: "" } : null)}>
        <option value="">{t.chooseGov}</option>
        {GOVERNORATE_OPTIONS.map((g) => (
          <option key={g.value} value={g.value}>{label(g)}</option>
        ))}
      </Select>
      <label htmlFor={`${idPrefix}-area`} className="sr-only">{t.chooseArea}</label>
      <Select id={`${idPrefix}-area`} value={place?.area ?? ""} disabled={!place || cities.length === 0} onChange={(e) => place && onChange({ gov: place.gov, area: e.target.value })}>
        <option value="">{t.chooseArea}</option>
        {cities.map((c) => (
          <option key={c.value} value={c.value}>{label(c)}</option>
        ))}
      </Select>
    </div>
  );
}
