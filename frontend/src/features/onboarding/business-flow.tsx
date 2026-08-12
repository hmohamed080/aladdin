"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Textarea, Select, LabeledField } from "@/components/ui/controls";
import { WizardShell, WizardProgress, ChoiceCard, FlowActions, SavedHint } from "@/features/onboarding/wizard";
import { saveBusiness, submitBusiness, type BusinessInput } from "@/server/actions/business-onboarding";
import type { BusinessAnswers } from "@/server/queries/onboarding";
import { BUSINESS_ORG_TYPES, businessOrgTypeFromAccountType, type BusinessOrgType } from "@/lib/onboarding/account-types";
import { GOVERNORATES, CITIES_BY_GOVERNORATE, isGovernorate } from "@/lib/onboarding/persona-fields";

/**
 * Business creation — "create my showroom", not "create an organization".
 *
 * One flow serves both entry points (a new registration that chose a business
 * type, and an existing account adding another business) because both write the
 * same draft. Three properties matter:
 *
 *   * THE TYPE IS NEVER ASKED TWICE. When the person already picked "Showroom" at
 *     registration, that type is carried into the draft and its step is dropped
 *     from the wizard entirely.
 *   * THE CREATOR IS THE OWNER. There is no owner/manager confirmation to tick —
 *     owning is the relationship that creating a business produces, and it is
 *     established transactionally alongside the organization and its first branch.
 *   * RETRYING IS SAFE. Every save round-trips a draft id, and submit is keyed on
 *     it, so a slow network or an impatient second click yields ONE business.
 *
 * State lives in the database (hydrated on load), so the wizard resumes across
 * refresh and sign-out.
 */
type Step = "identity" | "type" | "location" | "branch" | "review";

type BState = {
  legalName: string;
  displayName: string;
  orgType: BusinessOrgType | null;
  description: string;
  governorate: string | null;
  city: string | null;
  primaryBranchName: string;
};

export function BusinessFlow({
  answers,
  presetOrgType,
  draftId: initialDraftId,
}: {
  answers: BusinessAnswers;
  presetOrgType: BusinessOrgType | null;
  draftId: string | null;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BState>({
    legalName: answers.legalName ?? "",
    displayName: answers.displayName ?? "",
    orgType: businessOrgTypeFromAccountType(answers.orgType) ?? presetOrgType,
    description: answers.description ?? "",
    governorate: answers.governorate,
    city: answers.city,
    primaryBranchName: answers.primaryBranchName ?? "",
  });

  // The type step exists only when the type is still unknown. A person who chose
  // "Showroom" to sign up is never asked what kind of business they are building.
  const typePreselected = Boolean(businessOrgTypeFromAccountType(answers.orgType) ?? presetOrgType);
  const steps: Step[] = typePreselected
    ? ["identity", "location", "branch", "review"]
    : ["identity", "type", "location", "branch", "review"];

  const identityDone = (s: BState) => s.displayName.trim().length > 0;
  const typeDone = (s: BState) => !!s.orgType;

  const [step, setStep] = useState<number>(() => {
    if (!identityDone(state)) return 0;
    if (!typePreselected && !typeDone(state)) return steps.indexOf("type");
    return steps.length - 1; // location + branch are optional; land on review
  });

  const current: Step = steps[step] ?? "review";
  const areaCities =
    state.governorate && isGovernorate(state.governorate) ? CITIES_BY_GOVERNORATE[state.governorate] : [];

  const set = (patch: Partial<BState>) => setState((s) => ({ ...s, ...patch }));
  const goto = (s: Step) => setStep(Math.max(steps.indexOf(s), 0));

  const toInput = (s: BState): BusinessInput => ({
    draftId,
    legalName: s.legalName.trim() || null,
    displayName: s.displayName.trim() || null,
    orgType: s.orgType,
    description: s.description.trim() || null,
    governorate: s.governorate,
    city: s.city,
    primaryBranchName: s.primaryBranchName.trim() || null,
  });

  const persistAdvance = () =>
    start(async () => {
      setError(null);
      const res = await saveBusiness(toInput(state));
      if (!res.ok) {
        setError(res.code ?? "onboarding.error.saveFailed");
        return;
      }
      if (res.draftId) setDraftId(res.draftId);
      setStep((x) => Math.min(x + 1, steps.length - 1));
    });

  const back = () => setStep((x) => Math.max(x - 1, 0));

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await submitBusiness(toInput(state));
      // A successful submit redirects; reaching here means it was rejected.
      if (res && !res.ok) setError(res.code ?? "onboarding.error.saveFailed");
    });

  const canContinue =
    current === "identity" ? identityDone(state) : current === "type" ? typeDone(state) : true;

  const progress = (
    <WizardProgress current={step} total={steps.length} label={t(`onboarding.business.step.${current}`)} />
  );

  return (
    <WizardShell
      progress={progress}
      title={t(`onboarding.business.${current}.title`)}
      subtitle={t(`onboarding.business.${current}.subtitle`)}
    >
      {current === "identity" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.business.identity.displayNameLabel")} htmlFor="bname">
            <Input
              id="bname"
              value={state.displayName}
              maxLength={120}
              placeholder={t("onboarding.business.identity.displayNamePlaceholder")}
              onChange={(e) => set({ displayName: e.target.value })}
            />
          </LabeledField>
          <LabeledField label={t("onboarding.business.identity.legalNameLabel")} htmlFor="blegal" optional={t("common.optional")}>
            <Input
              id="blegal"
              value={state.legalName}
              maxLength={120}
              placeholder={t("onboarding.business.identity.legalNamePlaceholder")}
              onChange={(e) => set({ legalName: e.target.value })}
            />
          </LabeledField>
          <LabeledField label={t("onboarding.business.identity.descriptionLabel")} htmlFor="bdesc" optional={t("common.optional")}>
            <Textarea
              id="bdesc"
              value={state.description}
              maxLength={1000}
              placeholder={t("onboarding.business.identity.descriptionPlaceholder")}
              onChange={(e) => set({ description: e.target.value })}
            />
          </LabeledField>
        </div>
      ) : null}

      {current === "type" ? (
        <LabeledField label={t("onboarding.business.type.label")} htmlFor="btype">
          <div id="btype" className="grid gap-2.5 tablet:grid-cols-2">
            {BUSINESS_ORG_TYPES.map((k) => (
              <ChoiceCard
                key={k}
                selected={state.orgType === k}
                title={t(`onboarding.business.orgTypes.${k}`)}
                description={t(`onboarding.business.orgTypeDesc.${k}`)}
                onSelect={() => set({ orgType: k })}
              />
            ))}
          </div>
        </LabeledField>
      ) : null}

      {current === "location" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.business.location.governorateLabel")} htmlFor="bgov" optional={t("common.optional")}>
            <Select
              id="bgov"
              value={state.governorate ?? ""}
              onChange={(e) => set({ governorate: e.target.value || null, city: null })}
            >
              <option value="">{t("onboarding.business.location.choose")}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>{t(`onboarding.consumer.governorates.${g}`)}</option>
              ))}
            </Select>
          </LabeledField>
          {areaCities.length ? (
            <LabeledField label={t("onboarding.business.location.cityLabel")} htmlFor="bcity" optional={t("common.optional")}>
              <Select id="bcity" value={state.city ?? ""} onChange={(e) => set({ city: e.target.value || null })}>
                <option value="">{t("onboarding.business.location.choose")}</option>
                {areaCities.map((c) => (
                  <option key={c} value={c}>{t(`onboarding.consumer.cities.${c}`)}</option>
                ))}
              </Select>
            </LabeledField>
          ) : null}
          <p className="text-label text-fg-muted">{t("onboarding.business.location.note")}</p>
        </div>
      ) : null}

      {current === "branch" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.business.branch.nameLabel")} htmlFor="bbranch" optional={t("common.optional")}>
            <Input
              id="bbranch"
              value={state.primaryBranchName}
              maxLength={120}
              placeholder={t("onboarding.business.branch.namePlaceholder")}
              onChange={(e) => set({ primaryBranchName: e.target.value })}
            />
          </LabeledField>
          <p className="text-label text-fg-muted">{t("onboarding.business.branch.hint")}</p>
        </div>
      ) : null}

      {current === "review" ? (
        <div className="flex flex-col gap-lg">
          <dl className="flex flex-col divide-y divide-strong/60">
            {[
              { label: t("onboarding.business.review.name"), value: state.displayName || t("onboarding.consumer.notSet"), to: "identity" as Step },
              {
                label: t("onboarding.business.review.type"),
                value: state.orgType ? t(`onboarding.business.orgTypes.${state.orgType}`) : t("onboarding.consumer.notSet"),
                to: (typePreselected ? "identity" : "type") as Step,
              },
              {
                label: t("onboarding.business.review.location"),
                value: state.governorate ? t(`onboarding.consumer.governorates.${state.governorate}`) : t("onboarding.consumer.notSet"),
                to: "location" as Step,
              },
              {
                label: t("onboarding.business.review.branch"),
                value: state.primaryBranchName.trim() || state.displayName || t("onboarding.consumer.notSet"),
                to: "branch" as Step,
              },
            ].map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-label text-fg-muted">{r.label}</dt>
                  <dd className="break-words text-body text-fg">{r.value}</dd>
                </div>
                <button
                  type="button"
                  onClick={() => goto(r.to)}
                  className="shrink-0 text-label font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t("onboarding.edit")}
                </button>
              </div>
            ))}
          </dl>

          {/* The creator IS the owner — stated, never asked. */}
          <p className="rounded-md border border-strong/70 bg-surface-2/40 p-md text-body text-fg-secondary">
            {t("onboarding.business.review.ownerNote")}
          </p>
          <p className="text-label text-fg-secondary">{t("onboarding.business.review.reviewNote")}</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-label text-danger">
          {t(error)}
        </p>
      ) : null}

      <FlowActions
        onBack={step > 0 ? back : undefined}
        onPrimary={current === "review" ? submit : persistAdvance}
        primaryLabel={current === "review" ? t("onboarding.business.review.submit") : t("onboarding.continue")}
        primaryDisabled={current === "review" ? !typeDone(state) || !identityDone(state) : !canContinue}
        pending={pending}
      />
      <SavedHint />
    </WizardShell>
  );
}
