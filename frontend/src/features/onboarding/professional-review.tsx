"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Button, Spinner } from "@/components/ui/controls";
import { WizardProgress } from "@/features/onboarding/wizard";
import { TerminalPanel } from "@/features/onboarding/terminal-panel";
import { submitProfessional } from "@/server/actions/individual-onboarding";
import type { ProfessionalAnswers } from "@/server/queries/onboarding";

/** Review (05.2.6) — the last professional step. Summarizes every section with an
 * Edit link back to the wizard, then submits to the trusted upgrade/review workflow. */
export function ProfessionalReview({ answers }: { answers: ProfessionalAnswers }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();

  const specValue = answers.concreteType
    ? [t(`onboarding.professional.concreteType.${answers.concreteType}`), answers.yearsExperience != null ? t("onboarding.professional.review.years", { n: answers.yearsExperience }) : null]
        .filter(Boolean)
        .join(" · ")
    : t("onboarding.consumer.notSet");

  const rows = [
    { label: t("onboarding.professional.step.identity"), value: specValue },
    {
      label: t("onboarding.professional.step.services"),
      value: answers.services.length ? answers.services.map((k) => t(`onboarding.professional.serviceItems.${k}`)).join(" · ") : t("onboarding.consumer.notSet"),
    },
    {
      label: t("onboarding.professional.step.location"),
      value: [
        answers.governorate ? t(`onboarding.consumer.governorates.${answers.governorate}`) : null,
        answers.offersRemote ? t("onboarding.professional.review.remote") : null,
      ]
        .filter(Boolean)
        .join(" · ") || t("onboarding.consumer.notSet"),
    },
    { label: t("onboarding.professional.step.portfolio"), value: t("onboarding.professional.review.later") },
    { label: t("onboarding.professional.step.verification"), value: t("onboarding.professional.review.idExp") },
  ];

  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <WizardProgress current={5} total={6} label={t("onboarding.professional.step.review")} />
      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-headline text-fg">{t("onboarding.professional.review.title")}</h1>
        <p className="text-body-lg text-fg-secondary">{t("onboarding.professional.review.subtitle")}</p>
      </div>

      <dl className="flex flex-col divide-y divide-strong/60">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-label text-fg-muted">{r.label}</dt>
              <dd className="break-words text-body text-fg">{r.value}</dd>
            </div>
            <Link href="/onboarding/professional" className="shrink-0 text-label font-medium text-accent hover:underline">
              {t("onboarding.edit")}
            </Link>
          </div>
        ))}
      </dl>

      <Button type="button" onClick={() => start(async () => { await submitProfessional(); })} disabled={pending} aria-busy={pending} className="w-full">
        {pending ? (
          <>
            <Spinner />
            {t("onboarding.saving")}
          </>
        ) : (
          t("onboarding.professional.review.submit")
        )}
      </Button>
      <p className="text-center text-label text-fg-muted">{t("onboarding.savedProgress")}</p>
    </Card>
  );
}

/** After submission: the professional profile is with review (not activated). */
export function ProfessionalReviewPending() {
  const { t } = useI18n();
  return (
    <TerminalPanel
      tone="info"
      badge={t("onboarding.professional.review.pendingBadge")}
      title={t("onboarding.professional.review.pendingTitle")}
      body={t("onboarding.professional.review.pendingBody")}
    />
  );
}
