"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError } from "@/components/ui/primitives";
import { Input, Select, SubmitButton } from "@/components/ui/controls";
import { PhoneField } from "@/components/ui/phone-field";
import { ChoiceChip } from "@/features/onboarding/wizard";
import { GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { businessCitiesOf, CUSTOM_CITY_MAX } from "@/lib/location/business-location";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { saveAccountBasics, type AccountBasicsState } from "@/server/actions/account-basics";
import type { MissingBasics } from "@/server/queries/account-basics";

const INITIAL: AccountBasicsState = { ok: false };
/** "Other" in the town list: a UI control only, never sent as a town. */
const OTHER = "__other__";

/**
 * One short screen, three questions in the order a person answers them
 * fastest: how to reach you, where you are, what you do. Sections the account
 * already completed are not rendered at all. Specialties are chips: the first
 * one picked is the main one (marked), as on the Craftsman profile.
 */
export function AccountBasicsForm({ missing, tradeKeys, next }: { missing: MissingBasics; tradeKeys: string[]; next: string }) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useActionState(saveAccountBasics, INITIAL);
  const [governorate, setGovernorate] = useState("");
  const [city, setCity] = useState("");
  const [cityCustom, setCityCustom] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const label = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const byLabel = (a: LocationOption, b: LocationOption) => label(a).localeCompare(label(b), locale);
  const governorates = [...GOVERNORATE_OPTIONS].sort(byLabel);
  const cities = businessCitiesOf(governorate).sort(byLabel);
  const errorFor = (field: AccountBasicsState["field"]) => (state.field === field && state.code ? t(state.code) : undefined);
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <Card className="flex flex-col gap-lg p-lg">
      <header className="flex flex-col gap-xs">
        <h1 className="text-title font-bold text-fg">{t("accountBasics.title")}</h1>
        <p className="text-body text-fg-secondary">{t("accountBasics.subtitle")}</p>
      </header>

      <form action={dispatch} className="flex flex-col gap-lg" noValidate>
        <input type="hidden" name="next" value={next} />

        {missing.phone ? (
          <section className="flex flex-col gap-xs" aria-labelledby="basics-phone">
            <label id="basics-phone" htmlFor="phone" className="text-label font-semibold text-fg">
              {t("accountBasics.phoneLabel")}
            </label>
            <PhoneField id="phone" name="phone" countryName="phoneCountry" joined onChange={() => {}} error={errorFor("phone")} />
            <p className="text-label text-fg-muted">{t("accountBasics.phoneHint")}</p>
          </section>
        ) : null}

        {missing.location ? (
          <section className="flex flex-col gap-xs" aria-labelledby="basics-location">
            <p id="basics-location" className="text-label font-semibold text-fg">{t("accountBasics.locationLabel")}</p>
            <div className="grid gap-sm sm:grid-cols-2">
              <Select
                id="governorate"
                name="governorate"
                required
                aria-label={t("accountBasics.governorateLabel")}
                value={governorate}
                onChange={(e) => {
                  setGovernorate(e.target.value);
                  setCity("");
                  setCityCustom("");
                }}
              >
                <option value="" disabled>{t("accountBasics.governorateLabel")}</option>
                {governorates.map((g) => (
                  <option key={g.value} value={g.value}>{label(g)}</option>
                ))}
              </Select>
              <Select
                id="city"
                required
                disabled={!governorate}
                aria-label={t("accountBasics.cityLabel")}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (e.target.value !== OTHER) setCityCustom("");
                }}
              >
                <option value="" disabled>{t("accountBasics.cityLabel")}</option>
                {cities.map((c) => (
                  <option key={c.value} value={c.value}>{label(c)}</option>
                ))}
                <option value={OTHER}>{t("accountBasics.cityOther")}</option>
              </Select>
            </div>
            {city === OTHER ? (
              <Input
                id="cityCustom"
                name="cityCustom"
                value={cityCustom}
                maxLength={CUSTOM_CITY_MAX}
                aria-label={t("accountBasics.cityCustomLabel")}
                placeholder={t("accountBasics.cityCustomLabel")}
                onChange={(e) => setCityCustom(e.target.value)}
              />
            ) : null}
            <input type="hidden" name="city" value={city === OTHER ? "" : city} />
            {errorFor("location") ? <InlineError>{errorFor("location")}</InlineError> : null}
          </section>
        ) : null}

        {missing.specialties ? (
          <section className="flex flex-col gap-xs" aria-labelledby="basics-specialties">
            <p id="basics-specialties" className="text-label font-semibold text-fg">{t("accountBasics.specialtiesLabel")}</p>
            <p className="text-label text-fg-muted">{t("accountBasics.specialtiesHint")}</p>
            <div className="flex flex-wrap gap-xs" role="group" aria-labelledby="basics-specialties">
              {tradeKeys.map((key) => (
                <ChoiceChip
                  key={key}
                  selected={picked.includes(key)}
                  label={picked[0] === key ? `${tradeLabel(t, key)} · ${t("accountBasics.main")}` : tradeLabel(t, key)}
                  onToggle={() => toggle(key)}
                />
              ))}
            </div>
            {picked.map((key) => (
              <input key={key} type="hidden" name="specialties" value={key} />
            ))}
            {errorFor("specialties") ? <InlineError>{errorFor("specialties")}</InlineError> : null}
          </section>
        ) : null}

        {state.code && !state.field ? <InlineError>{t(state.code)}</InlineError> : null}
        <SubmitButton className="w-full" pendingLabel={t("accountBasics.saving")}>
          {t("accountBasics.submit")}
        </SubmitButton>
      </form>
    </Card>
  );
}
