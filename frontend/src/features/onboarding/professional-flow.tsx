"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Textarea, Select, LabeledField, Checkbox } from "@/components/ui/controls";
import { Badge } from "@/components/ui/primitives";
import { WizardShell, WizardProgress, ChoiceCard, ChoiceChip, FlowActions, SavedHint } from "@/features/onboarding/wizard";
import { saveProfessional, saveProfessionalAndReview, type ProfessionalInput } from "@/server/actions/individual-onboarding";
import type { ProfessionalAnswers } from "@/server/queries/onboarding";
import {
  type ProfessionalPersona,
  ENGINEER_DESIGNER_TYPES,
  FIXED_CONCRETE_TYPE,
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

/** The six professional steps (05.2.1–6); review is a separate route (index 5). */
const STEPS = ["identity", "services", "location", "portfolio", "verification"] as const;
const TOTAL = 6;
type Step = (typeof STEPS)[number];

type PState = {
  concreteType: string | null;
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

function toInput(s: PState): ProfessionalInput {
  return {
    concreteType: (s.concreteType ?? undefined) as ProfessionalInput["concreteType"],
    headline: s.headline.trim() || null,
    yearsExperience: s.yearsExperience,
    specialization: s.specialization,
    bio: s.bio.trim() || null,
    services: s.services,
    additionalServices: s.additionalServices,
    languages: s.languages,
    availability: (s.availability as ProfessionalInput["availability"]) ?? null,
    serviceAreas: s.serviceAreas,
    offersRemote: s.offersRemote,
    governorate: s.governorate,
    city: s.city,
    maxTravelKm: s.maxTravelKm,
  };
}

const identityDone = (s: PState) => !!s.concreteType && s.headline.trim().length > 0 && s.yearsExperience != null && !!s.specialization;
const servicesDone = (s: PState) => s.services.length > 0;
const locationDone = (s: PState) => s.serviceAreas.length > 0 || s.offersRemote;

function firstIncomplete(s: PState): number {
  if (!identityDone(s)) return 0;
  if (!servicesDone(s)) return 1;
  if (!locationDone(s)) return 2;
  return 4; // portfolio (optional) + verification are informational
}

/**
 * Professional onboarding (05.2.x) — ONE common flow for all four individual
 * professionals: Identity → Services & Skills → Service Location → Portfolio →
 * Verification Requirements, then a Review route. The persona-specific branch is
 * minimal by design: engineer/designer resolves a concrete type (engineer vs
 * interior_designer) and every persona draws its specialization/service options
 * from its own set. State is hydrated from the DB and persisted per step; nothing
 * is activated here — submission hands off to the trusted upgrade/review workflow.
 */
export function ProfessionalFlow({ persona, answers }: { persona: ProfessionalPersona; answers: ProfessionalAnswers }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const fixed = FIXED_CONCRETE_TYPE[persona];
  const [state, setState] = useState<PState>({
    concreteType: answers.concreteType ?? fixed,
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
  const [step, setStep] = useState<number>(() => firstIncomplete(state));

  const current: Step = STEPS[step] ?? "verification";
  const concrete = state.concreteType;
  const specOptions = concrete ? SPECIALIZATIONS[concrete] ?? [] : [];
  const serviceOptions = concrete ? SERVICES[concrete] ?? [] : [];
  const addServiceOptions = concrete ? ADDITIONAL_SERVICES[concrete] ?? [] : [];
  const areaCities = state.governorate && isGovernorate(state.governorate) ? CITIES_BY_GOVERNORATE[state.governorate] : [];

  const set = (patch: Partial<PState>) => setState((s) => ({ ...s, ...patch }));
  const toggle = (key: keyof PState, v: string) =>
    setState((s) => {
      const arr = s[key] as string[];
      return { ...s, [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] };
    });

  const persistAdvance = () =>
    start(async () => {
      if (state.concreteType) await saveProfessional(toInput(state));
      setStep((x) => Math.min(x + 1, STEPS.length - 1));
    });
  const back = () => setStep((x) => Math.max(x - 1, 0));
  const toReview = () =>
    start(async () => {
      await saveProfessionalAndReview(toInput(state));
    });

  const canContinue =
    current === "identity" ? identityDone(state) : current === "services" ? servicesDone(state) : current === "location" ? locationDone(state) : true;

  const progress = <WizardProgress current={step} total={TOTAL} label={t(`onboarding.professional.step.${current}`)} />;

  return (
    <WizardShell progress={progress} title={t(`onboarding.professional.${current}.title`)} subtitle={t(`onboarding.professional.${current}.subtitle`)}>
      {current === "identity" ? (
        <div className="flex flex-col gap-md">
          {persona === "engineer_designer" ? (
            <LabeledField label={t("onboarding.professional.typeChoice.title")} htmlFor="ptype">
              <div id="ptype" className="grid gap-2.5 tablet:grid-cols-2">
                {ENGINEER_DESIGNER_TYPES.map((k) => (
                  <ChoiceCard
                    key={k}
                    selected={state.concreteType === k}
                    title={t(`onboarding.professional.concreteType.${k}`)}
                    onSelect={() => set({ concreteType: k, specialization: null, services: [], additionalServices: [] })}
                  />
                ))}
              </div>
            </LabeledField>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-label font-medium text-fg-secondary">{t("onboarding.professional.identity.professionLabel")}</span>
              <Badge tone="accent">{concrete ? t(`onboarding.professional.concreteType.${concrete}`) : ""}</Badge>
            </div>
          )}

          <LabeledField label={t("onboarding.professional.identity.headlineLabel")} htmlFor="headline">
            <Input id="headline" value={state.headline} maxLength={120} placeholder={t("onboarding.professional.identity.headlinePlaceholder")} onChange={(e) => set({ headline: e.target.value })} />
          </LabeledField>

          <LabeledField label={t("onboarding.professional.identity.yearsLabel")} htmlFor="years">
            <Input
              id="years"
              type="number"
              min={0}
              max={70}
              inputMode="numeric"
              value={state.yearsExperience ?? ""}
              onChange={(e) => set({ yearsExperience: e.target.value === "" ? null : Math.max(0, Math.min(70, Number(e.target.value))) })}
            />
          </LabeledField>

          {concrete && specOptions.length ? (
            <LabeledField label={t("onboarding.professional.identity.specializationLabel")} htmlFor="spec">
              <div id="spec" className="grid gap-2.5 tablet:grid-cols-2">
                {specOptions.map((k) => (
                  <ChoiceCard key={k} selected={state.specialization === k} title={t(`onboarding.professional.specializations.${k}`)} onSelect={() => set({ specialization: k })} />
                ))}
              </div>
            </LabeledField>
          ) : null}

          <LabeledField label={t("onboarding.professional.identity.bioLabel")} htmlFor="bio" optional={t("common.optional")}>
            <Textarea id="bio" value={state.bio} maxLength={1000} placeholder={t("onboarding.professional.identity.bioPlaceholder")} onChange={(e) => set({ bio: e.target.value })} />
          </LabeledField>
        </div>
      ) : null}

      {current === "services" ? (
        <div className="flex flex-col gap-lg">
          <LabeledField label={t("onboarding.professional.services.coreLabel")} htmlFor="core">
            <div id="core" className="flex flex-wrap gap-2">
              {serviceOptions.map((k) => (
                <ChoiceChip key={k} selected={state.services.includes(k)} label={t(`onboarding.professional.serviceItems.${k}`)} onToggle={() => toggle("services", k)} />
              ))}
            </div>
          </LabeledField>
          <LabeledField label={t("onboarding.professional.services.additionalLabel")} htmlFor="add" optional={t("common.optional")}>
            <div id="add" className="flex flex-wrap gap-2">
              {addServiceOptions.map((k) => (
                <ChoiceChip key={k} selected={state.additionalServices.includes(k)} label={t(`onboarding.professional.serviceItems.${k}`)} onToggle={() => toggle("additionalServices", k)} />
              ))}
            </div>
          </LabeledField>
          <LabeledField label={t("onboarding.professional.services.languagesLabel")} htmlFor="langs" optional={t("common.optional")}>
            <div id="langs" className="flex flex-wrap gap-2">
              {LANGUAGES.map((k) => (
                <ChoiceChip key={k} selected={state.languages.includes(k)} label={t(`onboarding.professional.languages.${k}`)} onToggle={() => toggle("languages", k)} />
              ))}
            </div>
          </LabeledField>
          <LabeledField label={t("onboarding.professional.services.availabilityLabel")} htmlFor="avail" optional={t("common.optional")}>
            <div id="avail" className="grid gap-2.5 tablet:grid-cols-3">
              {AVAILABILITIES.map((k) => (
                <ChoiceCard key={k} selected={state.availability === k} title={t(`onboarding.professional.availabilities.${k}`)} onSelect={() => set({ availability: state.availability === k ? null : k })} />
              ))}
            </div>
          </LabeledField>
        </div>
      ) : null}

      {current === "location" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.professional.location.governorateLabel")} htmlFor="gov">
            <Select id="gov" value={state.governorate ?? ""} onChange={(e) => set({ governorate: e.target.value || null, city: null, serviceAreas: [] })}>
              <option value="">{t("onboarding.professional.location.choose")}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>{t(`onboarding.consumer.governorates.${g}`)}</option>
              ))}
            </Select>
          </LabeledField>

          {areaCities.length ? (
            <LabeledField label={t("onboarding.professional.location.areasLabel")} htmlFor="areas">
              <div id="areas" className="flex flex-wrap gap-2">
                {areaCities.map((c) => (
                  <ChoiceChip key={c} selected={state.serviceAreas.includes(c)} label={t(`onboarding.consumer.cities.${c}`)} onToggle={() => toggle("serviceAreas", c)} />
                ))}
              </div>
            </LabeledField>
          ) : null}

          <div className="rounded-md border border-strong/70 bg-surface-2/40 p-md">
            <Checkbox id="remote" name="remote" checked={state.offersRemote} onChange={(v) => set({ offersRemote: v })}>
              <span className="flex flex-col">
                <span className="font-medium text-fg">{t("onboarding.professional.location.remoteLabel")}</span>
                <span className="text-label text-fg-muted">{t("onboarding.professional.location.remoteHint")}</span>
              </span>
            </Checkbox>
          </div>

          <LabeledField label={t("onboarding.professional.location.maxTravelLabel")} htmlFor="travel" optional={t("common.optional")}>
            <Select id="travel" value={state.maxTravelKm ?? ""} onChange={(e) => set({ maxTravelKm: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">{t("onboarding.professional.location.choose")}</option>
              {MAX_TRAVEL_KM.map((km) => (
                <option key={km} value={km}>{`${km} ${t("onboarding.professional.location.km")}`}</option>
              ))}
            </Select>
          </LabeledField>
        </div>
      ) : null}

      {current === "portfolio" ? (
        <div className="flex flex-col gap-md">
          <Badge tone="neutral">{t("onboarding.professional.portfolio.optionalTag")}</Badge>
          <p className="text-body text-fg-secondary">{t("onboarding.professional.portfolio.body")}</p>
        </div>
      ) : null}

      {current === "verification" ? (
        <ul className="flex flex-col gap-2.5">
          {(["idProof", "expProof", "photos", "privacy", "after"] as const).map((k) => (
            <li key={k} className="flex flex-col gap-0.5 rounded-md border border-strong/70 bg-surface-2/30 p-md">
              <span className="font-medium text-fg">{t(`onboarding.professional.verification.${k}Title`)}</span>
              <span className="text-label text-fg-secondary">{t(`onboarding.professional.verification.${k}Body`)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <FlowActions
        onBack={step > 0 ? back : undefined}
        onPrimary={current === "verification" ? toReview : persistAdvance}
        primaryLabel={current === "verification" ? t("onboarding.professional.toReview") : t("onboarding.continue")}
        primaryDisabled={!canContinue}
        pending={pending}
      />
      <SavedHint />
    </WizardShell>
  );
}
