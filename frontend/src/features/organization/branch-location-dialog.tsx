"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, LabeledField, Select } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { GOVERNORATE_OPTIONS, type LocationOption } from "@/lib/installer/location-data";
import { businessCitiesOf, CUSTOM_CITY_MAX } from "@/lib/location/business-location";
import type { BranchLocationValue } from "@/lib/location/describe-location";
import { setBranchLocationAction } from "@/server/actions/organization-profile";

/** The "Other" choice in the city list. A UI control only: it is never sent or stored as a city. */
const OTHER_VALUE = "__other__";

/**
 * Edit one branch's governorate and city - the location captured at registration - via `branch_location_set`.
 * Same catalogue and rules as the registration wizard, so a stored location always round-trips.
 */
export function BranchLocationDialog({ branchId, branchName, location }: { branchId: string; branchName: string; location: BranchLocationValue | undefined }) {
  const { t, locale } = useI18n();
  const [governorate, setGovernorate] = useState(location?.governorate ?? "");
  const [city, setCity] = useState(location?.cityCustomName ? OTHER_VALUE : (location?.city ?? ""));
  const [custom, setCustom] = useState(location?.cityCustomName ?? "");
  const label = (o: LocationOption) => (locale === "ar" ? o.ar : o.en);
  const collator = new Intl.Collator(locale === "ar" ? "ar" : "en");
  const byLabel = (a: LocationOption, b: LocationOption) => collator.compare(label(a), label(b));
  const governorates = [...GOVERNORATE_OPTIONS].sort(byLabel);
  const cities = businessCitiesOf(governorate || null).sort(byLabel);
  const other = city === OTHER_VALUE;

  return (
    <ConfirmDialog
      trigger={t("showroomSettings.location.edit")}
      triggerVariant="outline"
      title={t("showroomSettings.location.title", { name: branchName })}
      confirmLabel={t("common.saveChanges")}
      confirmVariant="accent"
      confirmDisabled={!governorate || (other ? custom.trim().length < 2 : !city)}
      formAction={setBranchLocationAction}
    >
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="city" value={other ? "" : city} />
      <p className="text-body text-fg-secondary">{t("showroomSettings.location.help")}</p>
      <LabeledField label={t("onboarding.business.location.governorateLabel")} htmlFor="loc-gov">
        <Select
          id="loc-gov"
          name="governorate"
          required
          value={governorate}
          onChange={(e) => { setGovernorate(e.target.value); setCity(""); setCustom(""); }}
        >
          <option value="">{t("onboarding.business.location.choose")}</option>
          {governorates.map((g) => <option key={g.value} value={g.value}>{label(g)}</option>)}
        </Select>
      </LabeledField>
      {governorate ? (
        <LabeledField label={t("onboarding.business.location.cityLabel")} htmlFor="loc-city">
          <Select id="loc-city" required value={city} onChange={(e) => { setCity(e.target.value); setCustom(""); }}>
            <option value="">{t("onboarding.business.location.choose")}</option>
            {cities.map((c) => <option key={c.value} value={c.value}>{label(c)}</option>)}
            <option value={OTHER_VALUE}>{t("onboarding.business.location.otherOption")}</option>
          </Select>
        </LabeledField>
      ) : null}
      {governorate && other ? (
        <LabeledField label={t("onboarding.business.location.customCityLabel")} htmlFor="loc-custom">
          <Input id="loc-custom" name="cityCustom" maxLength={CUSTOM_CITY_MAX} value={custom} placeholder={t("onboarding.business.location.customCityPlaceholder")} onChange={(e) => setCustom(e.target.value)} />
        </LabeledField>
      ) : null}
    </ConfirmDialog>
  );
}
