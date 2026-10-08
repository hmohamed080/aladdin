"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { ListboxSelect } from "@/components/ui/listbox";
import { ChoiceChip } from "@/features/onboarding/wizard";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { setServiceAreasAction, type AreasState } from "@/server/actions/service-areas";
import type { MyServiceAreas } from "@/server/queries/service-areas";

const INITIAL: AreasState = { ok: false };

type OtherArea = { governorateKey: string; cityKey: string };

/**
 * WHERE YOU WORK — the caller's canonical service areas.
 *
 * One MAIN governorate (where they are based) with the cities they cover inside it, plus any number of OTHER areas: a
 * whole governorate, or a single city of one. Every option comes from the same Egypt catalogue the job form and the
 * Jobs filters use (`lib/installer/location-data`), so a place chosen here is, key for key, a place a job can be in.
 *
 * It saves the COMPLETE set (one hidden field per concern), so a double submit converges and the database never holds
 * a half-edited list. Nothing here decides what a person may do: service areas only rank jobs (Near me) and feed the
 * location part of the Overall Match. They do not limit which jobs can be opened or applied to, and the card says so.
 */
export function ServiceAreasEditor({ value }: { value: MyServiceAreas }) {
  const { t, locale } = useI18n();
  const [state, submit] = useActionState(setServiceAreasAction, INITIAL);
  const [primary, setPrimary] = useState(value.primaryGovernorate ?? "");
  const [cities, setCities] = useState<string[]>(value.primaryCities);
  const [others, setOthers] = useState<OtherArea[]>(value.others.map((o) => ({ governorateKey: o.governorateKey, cityKey: o.cityKey ?? "" })));

  const name = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const governorateOptions = GOVERNORATE_OPTIONS.map((o) => ({ value: o.value, label: name(o) }));
  const coveredCities = (governorateKey: string) => (CITIES_BY_GOVERNORATE[governorateKey] ?? []).filter((c) => c.value !== "other");
  const placeLabel = (governorateKey: string, cityKey: string) => {
    const g = GOVERNORATE_OPTIONS.find((o) => o.value === governorateKey);
    const c = (CITIES_BY_GOVERNORATE[governorateKey] ?? []).find((o) => o.value === cityKey);
    return [c ? name(c) : null, g ? name(g) : governorateKey].filter(Boolean).join(locale === "ar" ? "، " : ", ");
  };

  const areas = [
    ...(primary ? cities.map((cityKey) => ({ governorateKey: primary, cityKey })) : []),
    ...others.filter((o) => o.governorateKey).map((o) => ({ governorateKey: o.governorateKey, cityKey: o.cityKey || null })),
  ];

  const changePrimary = (next: string) => {
    setPrimary(next);
    setCities([]);
    // Choosing a governorate as MAIN removes it from the "other" list — it cannot be both.
    setOthers((rows) => rows.filter((row) => row.governorateKey !== next));
  };
  const toggleCity = (key: string) => setCities((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const patchOther = (index: number, patch: Partial<OtherArea>) => setOthers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-col gap-1" data-testid="service-areas">
        <h2 className="text-title text-fg">{t("profile.serviceAreas.title")}</h2>
        <p className="max-w-prose text-body text-fg-secondary">{t("profile.serviceAreas.body")}</p>
      </div>

      <div className="grid gap-1 text-label text-fg-secondary">
        <span>{t("profile.serviceAreas.primary")}</span>
        <ListboxSelect
          label={t("profile.serviceAreas.primary")}
          value={primary}
          placeholder={t("profile.serviceAreas.primaryPlaceholder")}
          options={governorateOptions}
          onChange={changePrimary}
          className="max-w-sm"
        />
      </div>

      {primary && coveredCities(primary).length > 0 ? (
        <div className="grid gap-1.5">
          <p className="text-label font-medium text-fg-secondary">{t("profile.serviceAreas.cities")}</p>
          <div className="flex flex-wrap gap-2" data-testid="service-area-cities">
            {coveredCities(primary).map((city) => (
              <ChoiceChip key={city.value} selected={cities.includes(city.value)} label={name(city)} onToggle={() => toggleCity(city.value)} />
            ))}
          </div>
        </div>
      ) : null}

      {primary ? (
        <div className="grid gap-sm border-t pt-sm">
          <p className="text-label font-medium text-fg-secondary">{t("profile.serviceAreas.otherAreas")}</p>
          {others.length > 0 ? (
            <ul className="grid gap-sm">
              {others.map((row, index) => (
                <li key={index} className="grid gap-sm tablet:grid-cols-[1fr_1fr_auto] tablet:items-end" data-testid="other-service-area">
                  <div className="grid min-w-0 gap-1 text-label text-fg-secondary">
                    <span>{t("profile.serviceAreas.governorate")}</span>
                    <ListboxSelect
                      label={t("profile.serviceAreas.governorate")}
                      value={row.governorateKey}
                      placeholder={t("profile.serviceAreas.primaryPlaceholder")}
                      options={governorateOptions.filter((o) => o.value !== primary)}
                      onChange={(next) => patchOther(index, { governorateKey: next, cityKey: "" })}
                    />
                  </div>
                  <div className="grid min-w-0 gap-1 text-label text-fg-secondary">
                    <span>{t("profile.serviceAreas.city")}</span>
                    <ListboxSelect
                      label={t("profile.serviceAreas.city")}
                      value={row.cityKey}
                      disabled={!row.governorateKey}
                      options={[{ value: "", label: t("profile.serviceAreas.wholeGovernorate") }, ...coveredCities(row.governorateKey).map((c) => ({ value: c.value, label: name(c) }))]}
                      onChange={(next) => patchOther(index, { cityKey: next })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={t("profile.serviceAreas.removeAria", { place: row.governorateKey ? placeLabel(row.governorateKey, row.cityKey) : t("profile.serviceAreas.otherAreas") })}
                    onClick={() => setOthers((rows) => rows.filter((_, i) => i !== index))}
                    className="min-h-10 rounded-sm px-2 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {t("profile.serviceAreas.remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => setOthers((rows) => [...rows, { governorateKey: "", cityKey: "" }])}
            className="min-h-10 w-fit rounded-sm border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("profile.serviceAreas.addArea")}
          </button>
        </div>
      ) : null}

      <p className="max-w-prose text-label text-fg-muted">{t("profile.serviceAreas.note")}</p>

      <form action={submit} className="flex flex-wrap items-center gap-sm">
        <input type="hidden" name="primary" value={primary} />
        <input type="hidden" name="areas" value={JSON.stringify(areas)} />
        <SubmitButton variant="primary" size="sm" pendingLabel={t("profile.serviceAreas.saving")}>
          {t("profile.serviceAreas.save")}
        </SubmitButton>
        {state.ok ? <InlineSuccess>{t("profile.serviceAreas.saved")}</InlineSuccess> : null}
        {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
      </form>
    </Card>
  );
}
