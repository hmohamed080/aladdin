"use client";

import { useI18n } from "@/lib/i18n/context";
import { InlineError } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/controls";
import { GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { businessCitiesOf, CUSTOM_CITY_MAX } from "@/lib/location/business-location";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { activityLabel } from "@/features/profile/activity-selector";

/** "Other" in the town list: a UI control only, never sent as a town. */
export const OTHER_CITY = "__other__";

export type BasicsLocation = { governorate: string; city: string; cityCustom: string };

/**
 * Governorate, then a town of it (or "Other" + a typed town). Controlled; the
 * hidden `city` field never carries "Other".
 */
export function BasicsLocationFields({ value, onChange, error }: { value: BasicsLocation; onChange: (v: BasicsLocation) => void; error?: string }) {
  const { t, locale } = useI18n();
  const label = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const byLabel = (a: LocationOption, b: LocationOption) => label(a).localeCompare(label(b), locale);
  const governorates = [...GOVERNORATE_OPTIONS].sort(byLabel);
  const cities = businessCitiesOf(value.governorate).sort(byLabel);

  return (
    <div className="flex flex-col gap-xs">
      <div className="grid gap-sm sm:grid-cols-2">
        <Select
          id="governorate"
          name="governorate"
          required
          aria-label={t("accountBasics.governorateLabel")}
          value={value.governorate}
          onChange={(e) => onChange({ governorate: e.target.value, city: "", cityCustom: "" })}
        >
          <option value="" disabled>{t("accountBasics.governorateLabel")}</option>
          {governorates.map((g) => (
            <option key={g.value} value={g.value}>{label(g)}</option>
          ))}
        </Select>
        <Select
          id="city"
          required
          disabled={!value.governorate}
          aria-label={t("accountBasics.cityLabel")}
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value, cityCustom: e.target.value === OTHER_CITY ? value.cityCustom : "" })}
        >
          <option value="" disabled>{t("accountBasics.cityLabel")}</option>
          {cities.map((c) => (
            <option key={c.value} value={c.value}>{label(c)}</option>
          ))}
          <option value={OTHER_CITY}>{t("accountBasics.cityOther")}</option>
        </Select>
      </div>
      {value.city === OTHER_CITY ? (
        <Input
          id="cityCustom"
          name="cityCustom"
          value={value.cityCustom}
          maxLength={CUSTOM_CITY_MAX}
          aria-label={t("accountBasics.cityCustomLabel")}
          placeholder={t("accountBasics.cityCustomLabel")}
          onChange={(e) => onChange({ ...value, cityCustom: e.target.value })}
        />
      ) : null}
      <input type="hidden" name="city" value={value.city === OTHER_CITY ? "" : value.city} />
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}

/** A location the person can leave the step with: a governorate and a town (or a typed one). */
export function basicsLocationDone(v: BasicsLocation): boolean {
  return Boolean(v.governorate) && (v.city === OTHER_CITY ? v.cityCustom.trim().length >= 2 : Boolean(v.city));
}

/**
 * Specialties from a dropdown, listed below it as removable chips. The first
 * one picked is the main one (marked); removing it makes the next one main.
 * Submits as ordered hidden `specialties` fields.
 */
export type SpecialtyOption = { key: string; label: string };

/**
 * The list an account picks from, as the server loaded it: the Craftsman trade
 * keys or the persona activity keys (Engineer). Labels come from the i18n
 * catalogue either way.
 */
export type SpecialtySource = { kind: "trades" | "activities"; keys: string[] };

export function useSpecialtyOptions(source: SpecialtySource | null): SpecialtyOption[] {
  const { t } = useI18n();
  if (!source) return [];
  return source.keys.map((key) => ({ key, label: source.kind === "trades" ? tradeLabel(t, key) : activityLabel(t, key) }));
}

export function BasicsSpecialtiesField({
  options,
  picked,
  onChange,
  error,
}: {
  options: SpecialtyOption[];
  picked: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const { t } = useI18n();
  const labelOf = (key: string) => options.find((o) => o.key === key)?.label ?? key;
  return (
    <div className="flex flex-col gap-xs">
      <Select
        id="specialtyAdd"
        aria-label={t("accountBasics.specialtiesAdd")}
        value=""
        disabled={picked.length >= options.length}
        onChange={(e) => {
          const key = e.target.value;
          if (key && !picked.includes(key)) onChange([...picked, key]);
        }}
      >
        <option value="" disabled>{t("accountBasics.specialtiesAdd")}</option>
        {options
          .filter((o) => !picked.includes(o.key))
          .map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
      </Select>
      {picked.length ? (
        <ul className="flex flex-wrap gap-xs">
          {picked.map((key, i) => (
            <li key={key} className="inline-flex items-center gap-1 rounded-pill border border-accent bg-accent-solid/15 py-1 ps-3.5 pe-1 text-label font-medium text-fg">
              <span>{i === 0 ? `${labelOf(key)} · ${t("accountBasics.main")}` : labelOf(key)}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-pill text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                aria-label={t("accountBasics.specialtiesRemove", { name: labelOf(key) })}
                onClick={() => onChange(picked.filter((k) => k !== key))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picked.map((key) => (
        <input key={key} type="hidden" name="specialties" value={key} />
      ))}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
