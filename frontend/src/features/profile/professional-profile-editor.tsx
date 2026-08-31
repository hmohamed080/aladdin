"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Input, Textarea, Select, LabeledField, Checkbox, Button } from "@/components/ui/controls";
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
 * `city` is CARRIED, not edited. The professional flow collects a governorate and
 * service areas and never a base city, but the column exists and may hold a value
 * from elsewhere — passing it back unchanged stops an edit of the headline from
 * silently erasing it.
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
  maxTravelKm: number | null;
};

export function ProfessionalProfileEditor({
  answers,
  concreteType,
}: {
  answers: ProfessionalAnswers;
  /** The persona this profile belongs to — fixed, and the vocabulary key. */
  concreteType: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

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
    maxTravelKm: answers.maxTravelKm,
  });

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
        // Carried through untouched — see the note above.
        city: answers.city,
        maxTravelKm: state.maxTravelKm,
      };
      const result = await saveProfessional(input);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Back to the hub, which re-reads from the database — so what is shown after
      // a save is what was actually stored, never the form's own optimism.
      router.push("/home/profile");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-xl" data-testid="profile-editor">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline text-fg">{t("profile.edit.title")}</h1>
        <p className="max-w-prose text-body text-fg-secondary">{t("profile.edit.body")}</p>
      </header>

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
          <Input
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
          />
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
          <Textarea
            id="bio"
            value={state.bio}
            maxLength={1000}
            placeholder={t("onboarding.professional.identity.bioPlaceholder")}
            onChange={(e) => set({ bio: e.target.value })}
          />
        </LabeledField>
      </Card>

      <Card className="flex flex-col gap-lg">
        <LabeledField label={t("onboarding.professional.services.coreLabel")} htmlFor="core">
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
        </LabeledField>

        <LabeledField
          label={t("onboarding.professional.services.additionalLabel")}
          htmlFor="add"
          optional={t("common.optional")}
        >
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
        </LabeledField>

        <LabeledField
          label={t("onboarding.professional.services.languagesLabel")}
          htmlFor="langs"
          optional={t("common.optional")}
        >
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
        </LabeledField>

        <LabeledField
          label={t("onboarding.professional.services.availabilityLabel")}
          htmlFor="avail"
          optional={t("common.optional")}
        >
          <div id="avail" className="grid gap-2.5 tablet:grid-cols-3">
            {AVAILABILITIES.map((k) => (
              <ChoiceCard
                key={k}
                selected={state.availability === k}
                title={t(`onboarding.professional.availabilities.${k}`)}
                onSelect={() => set({ availability: state.availability === k ? null : k })}
              />
            ))}
          </div>
        </LabeledField>
      </Card>

      <Card className="flex flex-col gap-lg">
        <LabeledField label={t("onboarding.professional.location.governorateLabel")} htmlFor="gov">
          <Select
            id="gov"
            value={state.governorate ?? ""}
            onChange={(e) => set({ governorate: e.target.value || null, serviceAreas: [] })}
          >
            <option value="">{t("onboarding.professional.location.choose")}</option>
            {GOVERNORATES.map((g) => (
              <option key={g} value={g}>
                {t(`onboarding.consumer.governorates.${g}`)}
              </option>
            ))}
          </Select>
        </LabeledField>

        {areaCities.length ? (
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
        </LabeledField>
      </Card>

      {failed ? (
        <p role="alert" className="text-body text-danger">
          {t("profile.edit.saveFailed")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-sm">
        <Button type="button" variant="primary" onClick={save} disabled={pending}>
          {pending ? t("profile.edit.saving") : t("profile.edit.save")}
        </Button>
        <Link href="/home/profile">
          <Button type="button" variant="ghost">
            {t("profile.edit.cancel")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
