"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { LabeledField, Select } from "@/components/ui/controls";
import { Badge } from "@/components/ui/primitives";
import { WizardShell, WizardProgress, ChoiceCard, ChoiceChip, FlowActions, SavedHint } from "@/features/onboarding/wizard";
import { TerminalPanel } from "@/features/onboarding/terminal-panel";
import { saveConsumer, completeConsumer, type ConsumerInput } from "@/server/actions/individual-onboarding";
import type { ConsumerAnswers } from "@/server/queries/onboarding";
import {
  CONSUMER_INTENTS,
  CONSUMER_INTERESTS,
  CONSUMER_BUDGETS,
  GOVERNORATES,
  CITIES_BY_GOVERNORATE,
  isGovernorate,
} from "@/lib/onboarding/persona-fields";

/** The five consumer steps (05.1.1–5). Review is the last; all steps are optional. */
const STEPS = ["intent", "interests", "location", "budget", "review"] as const;
type Step = (typeof STEPS)[number];

type State = {
  intent: string | null;
  interests: string[];
  governorate: string | null;
  city: string | null;
  budget: string | null;
};

function toInput(s: State): ConsumerInput {
  return {
    intent: (s.intent as ConsumerInput["intent"]) ?? null,
    interests: s.interests,
    governorate: s.governorate,
    city: s.city,
    budget: (s.budget as ConsumerInput["budget"]) ?? null,
  };
}

/** Resume at the first step without an answer (all optional → never traps). */
function firstIncomplete(s: State): number {
  if (!s.intent) return 0;
  if (s.interests.length === 0) return 1;
  if (!s.governorate) return 2;
  if (!s.budget) return 3;
  return 4;
}

/**
 * Consumer onboarding (05.1.x): Project Overview → Interests → General Location →
 * Optional Budget → Review. Every step is optional and skippable; state is hydrated
 * from the DB (no client store) and persisted on each Continue, so refresh / Back /
 * sign-out resume without loss. Completion is a handoff — no account is activated
 * and no organization is created.
 */
export function ConsumerFlow({ answers }: { answers: ConsumerAnswers }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [state, setState] = useState<State>({
    intent: answers.intent,
    interests: answers.interests,
    governorate: answers.governorate,
    city: answers.city,
    budget: answers.budget,
  });
  const [step, setStep] = useState<number>(() => firstIncomplete(state));

  const current: Step = STEPS[step] ?? "review";
  const stepLabel = t(`onboarding.consumer.step.${current}`);
  const cities = state.governorate && isGovernorate(state.governorate) ? CITIES_BY_GOVERNORATE[state.governorate] : [];

  const persist = (next: State, then: () => void) =>
    start(async () => {
      await saveConsumer(toInput(next));
      then();
    });

  const advance = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const finish = () =>
    start(async () => {
      await completeConsumer(toInput(state));
    });

  const progress = <WizardProgress current={step} total={STEPS.length} label={stepLabel} />;

  if (current === "review") {
    const rows: { label: string; value: string; target: number }[] = [
      { label: t("onboarding.consumer.step.intent"), value: state.intent ? t(`onboarding.consumer.intents.${state.intent}`) : t("onboarding.consumer.notSet"), target: 0 },
      {
        label: t("onboarding.consumer.step.interests"),
        value: state.interests.length ? state.interests.map((k) => t(`onboarding.consumer.interests.${k}`)).join(" · ") : t("onboarding.consumer.notSet"),
        target: 1,
      },
      {
        label: t("onboarding.consumer.step.location"),
        value: state.governorate
          ? [t(`onboarding.consumer.governorates.${state.governorate}`), state.city ? t(`onboarding.consumer.cities.${state.city}`) : null].filter(Boolean).join(" · ")
          : t("onboarding.consumer.notSet"),
        target: 2,
      },
      { label: t("onboarding.consumer.step.budget"), value: state.budget ? t(`onboarding.consumer.budgets.${state.budget}`) : t("onboarding.consumer.notSet"), target: 3 },
    ];
    return (
      <WizardShell progress={progress} title={t("onboarding.consumer.review.title")} subtitle={t("onboarding.consumer.review.subtitle")}>
        <dl className="flex flex-col divide-y divide-strong/60">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-3 py-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-label text-fg-muted">{r.label}</dt>
                <dd className="text-body text-fg">{r.value}</dd>
              </div>
              <button type="button" onClick={() => setStep(r.target)} className="shrink-0 text-label font-medium text-accent hover:underline">
                {t("onboarding.edit")}
              </button>
            </div>
          ))}
        </dl>
        <FlowActions onBack={back} onPrimary={finish} primaryLabel={t("onboarding.consumer.review.finish")} pending={pending} />
        <SavedHint />
      </WizardShell>
    );
  }

  return (
    <WizardShell progress={progress} title={t(`onboarding.consumer.${current}.title`)} subtitle={t(`onboarding.consumer.${current}.subtitle`)}>
      {current === "intent" ? (
        <div className="flex flex-col gap-2.5">
          {CONSUMER_INTENTS.map((k) => (
            <ChoiceCard key={k} selected={state.intent === k} title={t(`onboarding.consumer.intents.${k}`)} onSelect={() => setState((s) => ({ ...s, intent: k }))} />
          ))}
          <div className="mt-1 flex items-start gap-2 rounded-md border border-strong/70 bg-surface-2/40 p-md">
            <Badge tone="neutral">{t("onboarding.consumer.intent.privacyTitle")}</Badge>
            <p className="text-label text-fg-secondary">{t("onboarding.consumer.intent.privacyBody")}</p>
          </div>
        </div>
      ) : null}

      {current === "interests" ? (
        <div className="flex flex-wrap gap-2">
          {CONSUMER_INTERESTS.map((k) => (
            <ChoiceChip
              key={k}
              selected={state.interests.includes(k)}
              label={t(`onboarding.consumer.interests.${k}`)}
              onToggle={() => setState((s) => ({ ...s, interests: s.interests.includes(k) ? s.interests.filter((x) => x !== k) : [...s.interests, k] }))}
            />
          ))}
        </div>
      ) : null}

      {current === "location" ? (
        <div className="flex flex-col gap-md">
          <LabeledField label={t("onboarding.consumer.location.governorateLabel")} htmlFor="gov">
            <Select id="gov" value={state.governorate ?? ""} onChange={(e) => setState((s) => ({ ...s, governorate: e.target.value || null, city: null }))}>
              <option value="">{t("onboarding.consumer.location.choose")}</option>
              {GOVERNORATES.map((g) => (
                <option key={g} value={g}>{t(`onboarding.consumer.governorates.${g}`)}</option>
              ))}
            </Select>
          </LabeledField>
          <LabeledField label={t("onboarding.consumer.location.cityLabel")} htmlFor="city" hint={t("onboarding.consumer.location.note")}>
            <Select id="city" value={state.city ?? ""} disabled={!state.governorate} onChange={(e) => setState((s) => ({ ...s, city: e.target.value || null }))}>
              <option value="">{t("onboarding.consumer.location.choose")}</option>
              {cities.map((c) => (
                <option key={c} value={c}>{t(`onboarding.consumer.cities.${c}`)}</option>
              ))}
            </Select>
          </LabeledField>
        </div>
      ) : null}

      {current === "budget" ? (
        <div className="flex flex-col gap-2.5">
          <Badge tone="neutral">{t("onboarding.consumer.budget.optionalTag")}</Badge>
          {CONSUMER_BUDGETS.map((k) => (
            <ChoiceCard key={k} selected={state.budget === k} title={t(`onboarding.consumer.budgets.${k}`)} onSelect={() => setState((s) => ({ ...s, budget: k }))} />
          ))}
        </div>
      ) : null}

      <FlowActions
        onBack={step > 0 ? back : undefined}
        onSkip={step === 0 ? finish : current === "budget" ? () => persist({ ...state, budget: null }, advance) : undefined}
        skipLabel={step === 0 ? t("onboarding.consumer.intent.skipAll") : t("onboarding.skip")}
        onPrimary={() => persist(state, advance)}
        primaryLabel={t("onboarding.continue")}
        pending={pending}
      />
      <SavedHint />
    </WizardShell>
  );
}

/** Consumer handoff terminal — completion, NOT activation. Shows a read-only recap. */
export function ConsumerComplete({ answers }: { answers: ConsumerAnswers }) {
  const { t } = useI18n();
  const rows: { label: string; value: string }[] = [
    { label: t("onboarding.consumer.step.intent"), value: answers.intent ? t(`onboarding.consumer.intents.${answers.intent}`) : t("onboarding.consumer.notSet") },
    {
      label: t("onboarding.consumer.step.interests"),
      value: answers.interests.length ? answers.interests.map((k) => t(`onboarding.consumer.interests.${k}`)).join(" · ") : t("onboarding.consumer.notSet"),
    },
    {
      label: t("onboarding.consumer.step.location"),
      value: answers.governorate ? t(`onboarding.consumer.governorates.${answers.governorate}`) : t("onboarding.consumer.notSet"),
    },
    { label: t("onboarding.consumer.step.budget"), value: answers.budget ? t(`onboarding.consumer.budgets.${answers.budget}`) : t("onboarding.consumer.notSet") },
  ];
  return (
    <TerminalPanel tone="success" badge={t("onboarding.consumer.complete.badge")} title={t("onboarding.consumer.complete.title")} body={t("onboarding.consumer.complete.body")}>
      <dl className="flex flex-col divide-y divide-strong/60 rounded-md border border-strong/70 bg-surface-2/30 px-md">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-2.5">
            <dt className="text-label text-fg-muted">{r.label}</dt>
            <dd className="text-label font-medium text-fg text-end">{r.value}</dd>
          </div>
        ))}
      </dl>
    </TerminalPanel>
  );
}
