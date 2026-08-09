"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Input, Textarea, Select, LabeledField, Checkbox } from "@/components/ui/controls";
import { WizardShell, WizardProgress, ChoiceCard, FlowActions, SavedHint } from "@/features/onboarding/wizard";
import { saveBusiness, submitBusiness, type BusinessInput } from "@/server/actions/business-onboarding";
import type { BusinessAnswers } from "@/server/queries/onboarding";
import { BUSINESS_ORG_TYPES, businessOrgTypeFromAccountType, type BusinessOrgType } from "@/lib/onboarding/account-types";
import { GOVERNORATES, CITIES_BY_GOVERNORATE, isGovernorate } from "@/lib/onboarding/persona-fields";

/**
 * Business / organization onboarding (Sprint 8) — ONE shared flow for every
 * business persona (Showroom/Dealer, Supplier, Manufacturer/Importer/Wholesaler,
 * and the generic Organization owner/manager). The persona-specific difference is
 * intentionally minimal: the chosen account type at the shared step pre-selects the
 * business type; the owner may still adjust it here. State is hydrated from the DB
 * and persisted per step. Nothing is activated mid-flow — submit creates the org
 * (pending_verification) + the owner's active membership + primary branch through
 * the trusted backend path, then lands the owner in the workspace.
 */
const STEPS = ["identity", "type", "location", "branch", "review"] as const;
const TOTAL = STEPS.length;
type Step = (typeof STEPS)[number];

type BState = {
  legalName: string;
  displayName: string;
  orgType: BusinessOrgType | null;
  description: string;
  governorate: string | null;
  city: string | null;
  primaryBranchName: string;
  ownerConfirmed: boolean;
};

function toInput(s: BState): BusinessInput {
  return {
    legalName: s.legalName.trim() || null,
    displayName: s.displayName.trim() || null,
    orgType: s.orgType,
    description: s.description.trim() || null,
    governorate: s.governorate,
    city: s.city,
    primaryBranchName: s.primaryBranchName.trim() || null,
    ownerConfirmed: s.ownerConfirmed,
  };
}

const identityDone = (s: BState) => s.displayName.trim().length > 0;
const typeDone = (s: BState) => !!s.orgType;

function firstIncomplete(s: BState): number {
  if (!identityDone(s)) return 0;
  if (!typeDone(s)) return 1;
  return 4; // location + branch are optional; land on review
}

export function BusinessFlow({
  answers,
  presetOrgType,
}: {
  answers: BusinessAnswers;
  presetOrgType: BusinessOrgType | null;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [state, setState] = useState<BState>({
    legalName: answers.legalName ?? "",
    displayName: answers.displayName ?? "",
    orgType: businessOrgTypeFromAccountType(answers.orgType) ?? presetOrgType,
    description: answers.description ?? "",
    governorate: answers.governorate,
    city: answers.city,
    primaryBranchName: answers.primaryBranchName ?? "",
    ownerConfirmed: answers.ownerConfirmed,
  });
  const [step, setStep] = useState<number>(() => firstIncomplete(state));

  const current: Step = STEPS[step] ?? "review";
  const areaCities =
    state.governorate && isGovernorate(state.governorate) ? CITIES_BY_GOVERNORATE[state.governorate] : [];

  const set = (patch: Partial<BState>) => setState((s) => ({ ...s, ...patch }));

  const persistAdvance = () =>
    start(async () => {
      await saveBusiness(toInput(state));
      setStep((x) => Math.min(x + 1, STEPS.length - 1));
    });
  const back = () => setStep((x) => Math.max(x - 1, 0));
  const submit = () =>
    start(async () => {
      await submitBusiness(toInput(state));
    });

  const canContinue =
    current === "identity" ? identityDone(state) : current === "type" ? typeDone(state) : true;

  const progress = <WizardProgress current={step} total={TOTAL} label={t(`onboarding.business.step.${current}`)} />;

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
              { label: t("onboarding.business.review.name"), value: state.displayName || t("onboarding.consumer.notSet"), to: 0 },
              {
                label: t("onboarding.business.review.type"),
                value: state.orgType ? t(`onboarding.business.orgTypes.${state.orgType}`) : t("onboarding.consumer.notSet"),
                to: 1,
              },
              {
                label: t("onboarding.business.review.location"),
                value: state.governorate ? t(`onboarding.consumer.governorates.${state.governorate}`) : t("onboarding.consumer.notSet"),
                to: 2,
              },
              {
                label: t("onboarding.business.review.branch"),
                value: state.primaryBranchName.trim() || state.displayName || t("onboarding.consumer.notSet"),
                to: 3,
              },
            ].map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-label text-fg-muted">{r.label}</dt>
                  <dd className="break-words text-body text-fg">{r.value}</dd>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(r.to)}
                  className="shrink-0 text-label font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t("onboarding.edit")}
                </button>
              </div>
            ))}
          </dl>

          <div className="rounded-md border border-strong/70 bg-surface-2/40 p-md">
            <Checkbox id="owner" name="owner" checked={state.ownerConfirmed} onChange={(v) => set({ ownerConfirmed: v })}>
              <span className="flex flex-col">
                <span className="font-medium text-fg">{t("onboarding.business.review.ownerConfirmLabel")}</span>
                <span className="text-label text-fg-muted">{t("onboarding.business.review.ownerConfirmHint")}</span>
              </span>
            </Checkbox>
          </div>

          <p className="text-label text-fg-secondary">{t("onboarding.business.review.reviewNote")}</p>
        </div>
      ) : null}

      <FlowActions
        onBack={step > 0 ? back : undefined}
        onPrimary={current === "review" ? submit : persistAdvance}
        primaryLabel={current === "review" ? t("onboarding.business.review.submit") : t("onboarding.continue")}
        primaryDisabled={current === "review" ? !state.ownerConfirmed || !typeDone(state) || !identityDone(state) : !canContinue}
        pending={pending}
      />
      <SavedHint />
    </WizardShell>
  );
}
