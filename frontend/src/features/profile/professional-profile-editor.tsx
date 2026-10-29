"use client";

import { useState, useTransition, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { menuItemClass } from "@/components/ui/menu";
import { useI18n } from "@/lib/i18n/context";
import { Input, Select, LabeledField, Checkbox, Button } from "@/components/ui/controls";
import { CalendarIcon, InfinityIcon, ChevronDownIcon, CheckIcon, PlusIcon, MinusCircleIcon, MapPinIcon, BuildingIcon } from "@/components/ui/icons";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { DESCRIPTION_MAX_CHARS, isAcceptableEdit } from "@/lib/text/description-limit";
import { Badge, Card } from "@/components/ui/primitives";
import { ChoiceCard, ChoiceChip } from "@/features/onboarding/wizard";
import { saveProfessional, type ProfessionalInput } from "@/server/actions/individual-onboarding";
import type { ProfessionalAnswers } from "@/server/queries/onboarding";
import {
  SPECIALIZATIONS,
  SERVICES,
  ADDITIONAL_SERVICES,
  LANGUAGES,
  AVAILABILITIES,
  GOVERNORATES,
  CITIES_BY_GOVERNORATE,
  MAX_TRAVEL_KM,
  isGovernorate,
} from "@/lib/onboarding/persona-fields";

/**
 * The standalone professional-profile editor.
 *
 * WHY IT IS NOT THE WIZARD. Until now the only way to change a profile was to
 * walk `/onboarding/professional` again — a six-step flow with a progress bar,
 * built to take someone who has entered nothing from nothing to submitted. Sending
 * an established professional back through it to fix one line tells them, twice
 * over, that they are unfinished. This is the same data on one page, in the same
 * groups, with one Save.
 *
 * NO NEW WRITE PATH. It calls `individual_save_professional` through the existing
 * `saveProfessional` action — the RPC was built re-entrant (`on conflict do
 * update`) precisely so it could back an editor, and every validation, the
 * authority check and the verified-caller check stay exactly where they are, in
 * the database.
 *
 * EVERY PROFESSIONAL WHO REACHES THIS PAGE CAN SAVE. That was not true when the
 * editor shipped: the RPC gated on `onboarding_progress.selected_track`, which no
 * seeded or Admin-upgraded professional has, so the form had to be replaced by an
 * explanation for exactly the accounts the Pilot runs on. `20260831090003` made
 * the gate ask about the professional IDENTITY instead — canonical or declared —
 * and the read-only fallback went with it. The page's own guard (`variant ===
 * "professional"`) and the database's authority check now agree.
 *
 * THE PERSONA IS NOT EDITABLE HERE, and shows as a badge. Changing what kind of
 * professional you are is the account-upgrade workflow's decision, not a select on
 * a profile form; offering it here would let someone rewrite a claim the platform
 * had already reviewed.
 *
 * Base city is editable in the embedded basic-information panel; other editors
 * preserve the saved value. All sections share one state and save payload.
 */

type EditorState = {
  headline: string;
  yearsExperience: number | null;
  specialization: string | null;
  bio: string;
  services: string[];
  additionalServices: string[];
  languages: string[];
  availability: string | null;
  serviceAreas: string[];
  offersRemote: boolean;
  governorate: string | null;
  city: string | null;
  maxTravelKm: number | null;
};

export function ProfessionalProfileEditor({
  answers,
  concreteType,
  embedded = false,
}: {
  answers: ProfessionalAnswers;
  /** Keep the saved editor in the profile-completion workspace. */
  embedded?: boolean;
  /** The persona this profile belongs to — fixed, and the vocabulary key. */
  concreteType: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const [state, setState] = useState<EditorState>({
    headline: answers.headline ?? "",
    yearsExperience: answers.yearsExperience,
    specialization: answers.specialization,
    bio: answers.bio ?? "",
    services: answers.services,
    additionalServices: answers.additionalServices,
    languages: answers.languages,
    availability: answers.availability,
    serviceAreas: answers.serviceAreas,
    offersRemote: answers.offersRemote,
    governorate: answers.governorate,
    city: answers.city,
    maxTravelKm: answers.maxTravelKm,
  });

  const [baseline, setBaseline] = useState(() => JSON.stringify(state));
  const dirty = JSON.stringify(state) !== baseline;

  const specOptions = SPECIALIZATIONS[concreteType] ?? [];
  const serviceOptions = SERVICES[concreteType] ?? [];
  const addServiceOptions = ADDITIONAL_SERVICES[concreteType] ?? [];
  const areaCities =
    state.governorate && isGovernorate(state.governorate) ? CITIES_BY_GOVERNORATE[state.governorate] : [];

  const set = (patch: Partial<EditorState>) => setState((s) => ({ ...s, ...patch }));
  const toggle = (key: "services" | "additionalServices" | "languages" | "serviceAreas", v: string) =>
    setState((s) => ({
      ...s,
      [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v],
    }));

  const save = () =>
    start(async () => {
      setFailed(false);
      setSaved(false);
      const input: ProfessionalInput = {
        concreteType: concreteType as ProfessionalInput["concreteType"],
        headline: state.headline.trim() || null,
        yearsExperience: state.yearsExperience,
        specialization: state.specialization,
        bio: state.bio.trim() || null,
        services: state.services,
        additionalServices: state.additionalServices,
        languages: state.languages,
        availability: state.availability as ProfessionalInput["availability"],
        serviceAreas: state.serviceAreas,
        offersRemote: state.offersRemote,
        governorate: state.governorate,
        city: state.city,
        maxTravelKm: state.maxTravelKm,
      };
      const result = await saveProfessional(input);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Back to the hub, which re-reads from the database — so what is shown after
      // a save is what was actually stored, never the form's own optimism.
      setBaseline(JSON.stringify(state));
      setSaved(true);
      if (!embedded) router.push("/home/profile");
      router.refresh();
    });

  return (
    <div className={`flex flex-col gap-xl ${embedded ? "engineer-edit-professional" : ""}`} data-testid="profile-editor">
      {!embedded && <header className="flex flex-col gap-1">
        <h1 className="text-headline text-fg">{t("profile.edit.title")}</h1>
        <p className="max-w-prose text-body text-fg-secondary">{t("profile.edit.body")}</p>
      </header>}

      <Card className="flex flex-col gap-lg">
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-fg-secondary">
            {t("onboarding.professional.identity.professionLabel")}
          </span>
          <span>
            <Badge tone="accent">{t(`onboarding.professional.concreteType.${concreteType}`)}</Badge>
          </span>
          <span className="text-label text-fg-muted">{t("profile.edit.personaFixed")}</span>
        </div>

        <LabeledField label={t("onboarding.professional.identity.headlineLabel")} htmlFor="headline">
          <Input
            id="headline"
            value={state.headline}
            maxLength={120}
            placeholder={t("onboarding.professional.identity.headlinePlaceholder")}
            onChange={(e) => set({ headline: e.target.value })}
          />
        </LabeledField>

        <LabeledField label={t("onboarding.professional.identity.yearsLabel")} htmlFor="years">
          {embedded ? <div className="grid min-h-11 grid-cols-3 overflow-hidden rounded-md border border-strong bg-canvas">
            <button type="button" aria-label={locale === "ar" ? "تقليل سنوات الخبرة" : "Decrease years"} disabled={(state.yearsExperience ?? 0) === 0} onClick={() => set({ yearsExperience: Math.max(0, (state.yearsExperience ?? 0) - 1) })} className="grid place-items-center border-e disabled:opacity-40"><MinusCircleIcon size={20} /></button>
            <output id="years" className="grid place-items-center font-semibold tabular-nums">{state.yearsExperience ?? 0}</output>
            <button type="button" aria-label={locale === "ar" ? "زيادة سنوات الخبرة" : "Increase years"} disabled={state.yearsExperience === 70} onClick={() => set({ yearsExperience: Math.min(70, (state.yearsExperience ?? 0) + 1) })} className="grid place-items-center border-s disabled:opacity-40"><PlusIcon size={20} /></button>
          </div> : (          <Input
            id="years"
            type="number"
            min={0}
            max={70}
            inputMode="numeric"
            value={state.yearsExperience ?? ""}
            onChange={(e) =>
              set({
                yearsExperience:
                  e.target.value === "" ? null : Math.max(0, Math.min(70, Number(e.target.value))),
              })
            }
          />) }
        </LabeledField>

        {specOptions.length ? (
          <LabeledField label={t("onboarding.professional.identity.specializationLabel")} htmlFor="spec">
            <div id="spec" className="grid gap-2.5 tablet:grid-cols-2">
              {specOptions.map((k) => (
                <ChoiceCard
                  key={k}
                  selected={state.specialization === k}
                  title={t(`onboarding.professional.specializations.${k}`)}
                  onSelect={() => set({ specialization: k })}
                />
              ))}
            </div>
          </LabeledField>
        ) : null}

        <LabeledField
          label={t("onboarding.professional.identity.bioLabel")}
          htmlFor="bio"
          optional={t("common.optional")}
        >
          <CountedTextarea
            id="bio"
            value={state.bio}
            max={DESCRIPTION_MAX_CHARS}
            unitLabel={t("showroomSettings.description.chars")}
            counterTestId="bio-count"
            placeholder={t("onboarding.professional.identity.bioPlaceholder")}
            onChange={(e) => set({ bio: e.target.value })}
          />
          {isAcceptableEdit(state.bio, answers.bio) ? null : (
            <p role="alert" className="mt-1 text-label text-danger">{t("onboarding.error.descriptionTooLong")}</p>
          )}
        </LabeledField>
      </Card>

      <Card className="flex flex-col gap-lg">
        <LabeledField label={t("onboarding.professional.services.coreLabel")} htmlFor="core">
          {embedded ? <ProfileMultiSelect id="core" options={serviceOptions} selected={state.services} label={(key) => t(`onboarding.professional.serviceItems.${key}`)} onToggle={(key) => toggle("services", key)} placeholder={locale === "ar" ? "اختر كل ما ينطبق عليك" : "Choose all that apply"} /> : (
          <div id="core" className="flex flex-wrap gap-2">
            {serviceOptions.map((k) => (
              <ChoiceChip
                key={k}
                selected={state.services.includes(k)}
                label={t(`onboarding.professional.serviceItems.${k}`)}
                onToggle={() => toggle("services", k)}
              />
            ))}
          </div>
          )}
        </LabeledField>

        <LabeledField
          label={t(concreteType === "engineer" ? "onboarding.professional.services.toolsLabel" : "onboarding.professional.services.additionalLabel")}
          htmlFor="add"
          optional={t("common.optional")}
        >
          {embedded ? <ProfileMultiSelect id="add" options={addServiceOptions} selected={state.additionalServices} label={(key) => t(`onboarding.professional.serviceItems.${key}`)} onToggle={(key) => toggle("additionalServices", key)} placeholder={locale === "ar" ? "اختر كل ما ينطبق عليك" : "Choose all that apply"} /> : (
          <div id="add" className="flex flex-wrap gap-2">
            {addServiceOptions.map((k) => (
              <ChoiceChip
                key={k}
                selected={state.additionalServices.includes(k)}
                label={t(`onboarding.professional.serviceItems.${k}`)}
                onToggle={() => toggle("additionalServices", k)}
              />
            ))}
          </div>
          )}
        </LabeledField>

        <LabeledField
          label={t("onboarding.professional.services.languagesLabel")}
          htmlFor="langs"
          optional={t("common.optional")}
        >
          {embedded ? <ProfileMultiSelect id="langs" options={LANGUAGES} selected={state.languages} label={(key) => t(`onboarding.professional.languages.${key}`)} onToggle={(key) => toggle("languages", key)} placeholder={locale === "ar" ? "اختر كل ما ينطبق عليك" : "Choose all that apply"} /> : (
          <div id="langs" className="flex flex-wrap gap-2">
            {LANGUAGES.map((k) => (
              <ChoiceChip
                key={k}
                selected={state.languages.includes(k)}
                label={t(`onboarding.professional.languages.${k}`)}
                onToggle={() => toggle("languages", k)}
              />
            ))}
          </div>
          )}
        </LabeledField>

        <EditorSlot enabled={embedded} target="engineer-availability-slot">        <LabeledField
          label={t("onboarding.professional.services.availabilityLabel")}
          htmlFor="avail"
          optional={t("common.optional")}
        >
          <div id="avail" className="grid gap-2.5 tablet:grid-cols-3">
            {AVAILABILITIES.map((k) => embedded ? (
              <button key={k} type="button" aria-pressed={state.availability === k} className="engineer-availability-choice" onClick={() => set({ availability: state.availability === k ? null : k })}>
                {k === "flexible" ? <InfinityIcon size={24} /> : <CalendarIcon size={24} />}
                <span>{k === "flexible" ? (locale === "ar" ? "حسب الطلب" : "On demand") : t(`onboarding.professional.availabilities.${k}`)}</span>
              </button>
            ) : (
              <ChoiceCard
                key={k}
                selected={state.availability === k}
                title={t(`onboarding.professional.availabilities.${k}`)}
                onSelect={() => set({ availability: state.availability === k ? null : k })}
              />
            ))}
          </div>
        </LabeledField>
        </EditorSlot>
      </Card>

      <Card className="flex flex-col gap-lg">
        <EditorSlot enabled={embedded} target="engineer-location-slot"><div className="grid gap-md tablet:grid-cols-2 mt-md">        <LabeledField label={t("onboarding.professional.location.governorateLabel")} htmlFor="gov">
          <div className="relative"><MapPinIcon size={19} className="pointer-events-none absolute start-3 top-3 z-10" /><Select className="ps-10"
            id="gov"
            value={state.governorate ?? ""}
            onChange={(e) => set({ governorate: e.target.value || null, serviceAreas: [], city: null })}
          >
            <option value="">{t("onboarding.professional.location.choose")}</option>
            {GOVERNORATES.map((g) => (
              <option key={g} value={g}>
                {t(`onboarding.consumer.governorates.${g}`)}
              </option>
            ))}
          </Select></div>
        </LabeledField>

        {embedded && <LabeledField label={locale === "ar" ? "المدينة" : "City"} htmlFor="engineer-city">
          <div className="relative"><BuildingIcon size={19} className="pointer-events-none absolute start-3 top-3 z-10" /><Select id="engineer-city" className="ps-10" disabled={!state.governorate} value={state.city ?? ""} onChange={(e) => set({ city: e.target.value || null })}>
            <option value="">{t("onboarding.professional.location.choose")}</option>
            {state.city && !areaCities.includes(state.city) && <option value={state.city}>{state.city}</option>}
            {areaCities.map(city => <option key={city} value={city}>{t(`onboarding.consumer.cities.${city}`)}</option>)}
          </Select></div>
        </LabeledField>}
</div></EditorSlot>
        {embedded ? <div className="space-y-md">
          <div><h3 className="font-semibold">{locale === "ar" ? "نطاق العمل" : "Work coverage"}</h3><p className="text-label text-fg-secondary">{locale === "ar" ? "هل تعمل في محافظات أخرى؟" : "Do you work in other governorates?"}</p></div>
          <div className="flex items-center justify-between gap-md rounded-md border border-strong p-md">
            <span id="coverage-label">{locale === "ar" ? "أعمل في محافظات أخرى" : "I work in other governorates"}</span>
            <button type="button" role="switch" aria-labelledby="coverage-label" aria-checked={(state.maxTravelKm ?? 0) > 0} className="engineer-coverage-switch" onClick={() => set({ maxTravelKm: (state.maxTravelKm ?? 0) > 0 ? 0 : 50 })}><span /></button>
          </div>
          {(state.maxTravelKm ?? 0) > 0 && <LabeledField label={t("onboarding.professional.location.maxTravelLabel")} htmlFor="travel"><Select id="travel" value={state.maxTravelKm ?? ""} onChange={e => set({ maxTravelKm: Number(e.target.value) })}>{MAX_TRAVEL_KM.filter(km => km > 0).map(km => <option key={km} value={km}>{km} {t("onboarding.professional.location.km")}</option>)}</Select></LabeledField>}
        </div> : <>        {areaCities.length ? (
          <LabeledField label={t("onboarding.professional.location.areasLabel")} htmlFor="areas">
            <div id="areas" className="flex flex-wrap gap-2">
              {areaCities.map((c) => (
                <ChoiceChip
                  key={c}
                  selected={state.serviceAreas.includes(c)}
                  label={t(`onboarding.consumer.cities.${c}`)}
                  onToggle={() => toggle("serviceAreas", c)}
                />
              ))}
            </div>
          </LabeledField>
        ) : null}

        <div className="rounded-md border border-strong/70 bg-surface-2/40 p-md">
          <Checkbox
            id="remote"
            name="remote"
            checked={state.offersRemote}
            onChange={(v) => set({ offersRemote: v })}
          >
            <span className="flex flex-col">
              <span className="font-medium text-fg">{t("onboarding.professional.location.remoteLabel")}</span>
              <span className="text-label text-fg-muted">{t("onboarding.professional.location.remoteHint")}</span>
            </span>
          </Checkbox>
        </div>

        <LabeledField
          label={t("onboarding.professional.location.maxTravelLabel")}
          htmlFor="travel"
          optional={t("common.optional")}
        >
          <Select
            id="travel"
            value={state.maxTravelKm ?? ""}
            onChange={(e) => set({ maxTravelKm: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">{t("onboarding.professional.location.choose")}</option>
            {MAX_TRAVEL_KM.map((km) => (
              <option key={km} value={km}>{`${km} ${t("onboarding.professional.location.km")}`}</option>
            ))}
          </Select>
        </LabeledField></>}

      </Card>

      <EditorSlot enabled={embedded} target="engineer-save-slot">
      {embedded && saved && !dirty && <p role="status" className="text-label text-success">{locale === "ar" ? "تم حفظ بياناتك." : "Your details have been saved."}</p>}
      {(!embedded || dirty || failed) && <>      {failed ? (
        <p role="alert" className="text-body text-danger">
          {t("profile.edit.saveFailed")}
        </p>
      ) : null}

      <div className={embedded ? "engineer-profile-savebar flex flex-wrap items-center gap-sm" : "flex flex-wrap items-center gap-sm"}>
        {embedded && <span className="me-auto">{locale === "ar" ? "لديك تغييرات غير محفوظة" : "You have unsaved changes"}</span>}
        <Button type="button" variant="primary" onClick={save} disabled={pending || !isAcceptableEdit(state.bio, answers.bio)}>
          {pending ? t("profile.edit.saving") : t("profile.edit.save")}
        </Button>
        {!embedded && <Link href="/home/profile">
          <Button type="button" variant="ghost">
            {t("profile.edit.cancel")}
          </Button>
        </Link>}
      </div></>}
      </EditorSlot>
    </div>
  );
}


function EditorSlot({ enabled, target, children }: { enabled: boolean; target: string; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => { if (enabled) setContainer(document.getElementById(target)); }, [enabled, target]);
  return enabled && container ? createPortal(children, container) : children;
}

function ProfileMultiSelect({ id, options, selected, label, onToggle, placeholder }: {
  id: string; options: readonly string[]; selected: string[];
  label: (key: string) => string; onToggle: (key: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = options.filter(key => selected.includes(key));
  return <div>
    <button id={id} ref={trigger} type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-strong bg-canvas p-1.5 text-start">
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">{chosen.length ? chosen.map(key => <span key={key} className="rounded-pill border bg-surface-2 px-2.5 py-1 text-label font-medium">{label(key)}</span>) : <span className="px-2 text-label text-fg-secondary">{placeholder}</span>}</span>
      <ChevronDownIcon size={18} className="mx-2 shrink-0" />
    </button>
    <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={trigger} role="dialog" placement="bottom-start" matchAnchorWidth>
      <div className="grid max-h-64 gap-1 overflow-y-auto p-2 tablet:grid-cols-2">
        {options.map(key => <button key={key} type="button" data-menu-item role="checkbox" aria-checked={selected.includes(key)} onClick={() => onToggle(key)} className={menuItemClass(selected.includes(key), "min-h-10 rounded-sm text-label")}>
          <span className={`grid size-5 shrink-0 place-items-center rounded-xs border border-strong ${selected.includes(key) ? "bg-accent-solid text-on-accent" : ""}`}>{selected.includes(key) && <CheckIcon size={13} />}</span>{label(key)}
        </button>)}
      </div>
    </FloatingMenu>
  </div>;
}
