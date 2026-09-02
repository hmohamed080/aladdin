"use client";

import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, StatePanel, Field, InlineError } from "@/components/ui/primitives";
import { Textarea, LabeledField } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MapPinIcon, BriefcaseIcon, ShieldIcon } from "@/components/ui/icons";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatMoney, formatDate, EMPTY } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import { ApplicationStatusBadge, JobStatusBadge, DecisionReason } from "./badges";
import { applyToJobAction, withdrawApplicationAction } from "@/server/actions/application-forms";
import type { FormState } from "@/server/actions/job-forms";

/**
 * The professional's DECISION surface for one opening.
 *
 * Not `/b2b/jobs/[jobId]` with different buttons. That page answers "what is the
 * state of my recruitment", and its hierarchy — lifecycle actions, applicant
 * counts, publish and cancel — is a manager's. This one answers a different
 * question: *should I take this work, and what exactly am I agreeing to?* So it
 * runs identity → who is offering → trade and place → compensation and schedule
 * → the description → and only then the action.
 *
 * WHAT IS WITHHELD, AND THAT IT IS SAID OUT LOUD. `site_address` is not in this
 * read seam at all: Increment 6 excludes it until somebody is actually assigned.
 * A blank where an address would be reads as missing data, so the page states
 * the rule instead — the professional learns the address exists and when they
 * will see it.
 *
 * NOTHING HERE IS AN AUTHORITY CHECK. Apply is offered when the opening is live
 * and the caller has no live candidacy; `job_application_submit` re-decides all
 * of it and would refuse a forged request identically.
 */

export type OpportunityView = {
  jobId: string;
  title: string;
  description: string | null;
  tradeKey: string | null;
  posterOrgName: string | null;
  governorate: string | null;
  city: string | null;
  offeredAmount: number | null;
  expectedDurationDays: number | null;
  startsOn: string | null;
  endsBy: string | null;
  publishedAt: string | null;
  /** Still open and its poster still verified — i.e. still in discovery. */
  discoverable: boolean;
  /** The job's own lifecycle state, known only for a job the caller applied to. */
  jobStatus: string | null;
};

export type MyCandidacy = {
  applicationId: string;
  status: string;
  note: string | null;
  appliedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
};

export function OpportunityDetail({
  job,
  application,
  canApply,
  locale,
}: {
  job: OpportunityView;
  application: MyCandidacy | null;
  /** False for a consumer account — the database refuses them, so nothing is offered. */
  canApply: boolean;
  locale: Locale;
}) {
  const { t } = useI18n();
  const place = [job.city, job.governorate].filter(Boolean).join(", ");
  const live = job.discoverable;

  return (
    <div className="flex flex-col gap-lg">
      {/* 1. Identity, and who is offering the work. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{job.title}</h1>
              {application ? <ApplicationStatusBadge status={application.status} /> : null}
            </div>
            {job.posterOrgName ? (
              <p className="text-body text-fg-secondary">
                {t("jobs.opportunities.postedBy")} {job.posterOrgName}
              </p>
            ) : null}
          </div>
          {/* The job's own state, and ONLY once it stops being a live opening.
              On a job you can still apply to, "Open" is noise; on one that was
              awarded elsewhere it is the explanation. */}
          {!job.discoverable && job.jobStatus ? <JobStatusBadge status={job.jobStatus} /> : null}
        </div>
      </Card>

      {/* 2. What is being offered — the facts a decision is actually made on. */}
      <Card className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
        <Field label={t("jobs.detail.compensation")}>
          <span className="text-title font-semibold text-fg">
            {formatMoney(job.offeredAmount, locale)}
          </span>
        </Field>
        <Field label={t("jobs.detail.trade")}>
          <span className="inline-flex items-center gap-1.5">
            <BriefcaseIcon size={15} className="shrink-0 text-fg-muted" />
            {job.tradeKey ? tradeLabel(t, job.tradeKey) : EMPTY}
          </span>
        </Field>
        <Field label={t("jobs.detail.location")}>
          <span className="inline-flex items-center gap-1.5">
            <MapPinIcon size={15} className="shrink-0 text-fg-muted" />
            {place || EMPTY}
          </span>
        </Field>
        <Field label={t("jobs.detail.duration")}>
          {job.expectedDurationDays
            ? t("jobs.opportunities.duration", { n: job.expectedDurationDays })
            : EMPTY}
        </Field>
      </Card>

      {/* 3. The work itself. */}
      {job.description ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-title text-fg">{t("jobs.detail.about")}</h2>
          <p className="max-w-prose whitespace-pre-line text-body text-fg-secondary">
            {job.description}
          </p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-md">
        <h2 className="text-title text-fg">{t("jobs.detail.whereAndWhen")}</h2>
        <div className="grid gap-md tablet:grid-cols-3">
          <Field label={t("jobs.detail.schedule")}>
            {job.startsOn || job.endsBy
              ? [job.startsOn, job.endsBy]
                  .filter(Boolean)
                  .map((d) => formatDate(d, locale))
                  .join(" → ")
              : EMPTY}
          </Field>
          <Field label={t("jobs.detail.posted")}>{formatDate(job.publishedAt, locale)}</Field>
          <Field label={t("jobs.detail.location")}>{place || EMPTY}</Field>
        </div>
        {/* The withheld field, NAMED. A silent absence reads as a gap in the
            posting; this reads as a rule, which is what it is. */}
        <p className="flex items-start gap-2 text-caption text-fg-muted">
          <ShieldIcon size={14} className="mt-0.5 shrink-0" />
          {t("jobs.detail.addressWithheld")}
        </p>
      </Card>

      {/* 4. Where this professional stands, and what they can do about it. */}
      <Card className="flex flex-col gap-md">
        {/* A heading only once there is something to head. Before applying, the
            card holds one button and naming it "Your application" would describe
            something that does not exist yet. */}
        {application ? <h2 className="text-title text-fg">{t("jobs.detail.yourApplication")}</h2> : null}
        {application ? (
          <CandidacyState
            application={application}
            reapplyAllowed={live && application.status === "withdrawn"}
            job={job}
            locale={locale}
          />
        ) : !job.discoverable ? (
          <StatePanel title={t("jobs.detail.gone")} body={t("jobs.detail.goneBody")} />
        ) : !canApply ? (
          <StatePanel
            tone="warning"
            title={t("jobs.apply.deniedTitle")}
            body={t("jobs.apply.deniedBody")}
          />
        ) : (
          <ApplyDialog job={job} locale={locale} />
        )}
      </Card>
    </div>
  );
}

/** What the caller's own candidacy is, and the one action it still permits. */
function CandidacyState({
  application,
  reapplyAllowed,
  job,
  locale,
}: {
  application: MyCandidacy;
  reapplyAllowed: boolean;
  job: OpportunityView;
  locale: Locale;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center gap-md text-caption text-fg-secondary">
        {application.appliedAt ? (
          <span>{t("jobs.applications.appliedOn", { date: formatDate(application.appliedAt, locale) })}</span>
        ) : null}
        {application.decidedAt ? (
          <span>{t("jobs.applications.decidedOn", { date: formatDate(application.decidedAt, locale) })}</span>
        ) : null}
      </div>

      {application.status === "accepted" ? (
        <div className="flex flex-col gap-1 rounded-md border border-success/30 bg-success/10 p-md">
          <p className="text-body-lg font-medium text-fg">{t("jobs.applications.accepted.title")}</p>
          <p className="text-body text-fg-secondary">{t("jobs.applications.accepted.body")}</p>
        </div>
      ) : null}

      {application.status === "rejected" ? (
        <div className="flex flex-col gap-sm">
          <p className="text-body-lg font-medium text-fg">
            {t("jobs.applications.rejected.title")}
          </p>
          {application.decisionReason ? (
            <div>
              <p className="text-label font-medium text-fg-muted">{t("jobs.applications.reason")}</p>
              <p className="text-body text-fg-secondary">
                <DecisionReason reason={application.decisionReason} />
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {application.note ? (
        <div>
          <p className="text-label font-medium text-fg-muted">{t("jobs.applications.yourNote")}</p>
          <p className="max-w-prose whitespace-pre-line text-body text-fg-secondary">
            {application.note}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-sm">
        {application.status === "submitted" ? (
          <ConfirmDialog
            trigger={t("jobs.withdraw.action")}
            triggerVariant="outline"
            title={t("jobs.withdraw.title")}
            body={t("jobs.withdraw.body")}
            confirmLabel={t("jobs.withdraw.confirm")}
            formAction={withdrawApplicationAction}
          >
            {(state: FormState) => (
              <>
                <input type="hidden" name="applicationId" value={application.applicationId} />
                <input type="hidden" name="jobId" value={job.jobId} />
                {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
              </>
            )}
          </ConfirmDialog>
        ) : null}

        {application.status === "withdrawn" ? (
          reapplyAllowed ? (
            <ApplyDialog job={job} locale={locale} again />
          ) : (
            /* §17: withdrawn AND no longer reapplicable is a distinct state from
               rejected, and saying so is the whole point of separating them. */
            <p className="text-body text-fg-secondary">{t("jobs.applications.withdrawn.closed")}</p>
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * The apply step: deliberate, one screen, no wizard.
 *
 * Before confirming, the professional sees which job, which organization and
 * what amount — restated inside the dialog, because "are you sure" without the
 * terms is not a decision. The note is optional and is the only input.
 */
function ApplyDialog({
  job,
  locale,
  again = false,
}: {
  job: OpportunityView;
  locale: Locale;
  again?: boolean;
}) {
  const { t } = useI18n();

  return (
    <ConfirmDialog
      trigger={t(again ? "jobs.apply.againAction" : "jobs.apply.action")}
      triggerVariant="accent"
      title={t(again ? "jobs.apply.againTitle" : "jobs.apply.title")}
      body={t(again ? "jobs.apply.againBody" : "jobs.apply.body")}
      confirmLabel={t("jobs.apply.confirm")}
      confirmVariant="accent"
      formAction={applyToJobAction}
    >
      {(state: FormState) => (
        <div className="flex flex-col gap-md text-start">
          <input type="hidden" name="jobId" value={job.jobId} />

          <div className="rounded-md border bg-surface-2 p-sm">
            <p className="text-label font-medium text-fg-muted">{t("jobs.apply.summary")}</p>
            <p className="text-body font-medium text-fg">{job.title}</p>
            {job.posterOrgName ? (
              <p className="text-caption text-fg-secondary">{job.posterOrgName}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {job.tradeKey ? <Badge>{tradeLabel(t, job.tradeKey)}</Badge> : null}
              <span className="text-body font-semibold text-fg">
                {formatMoney(job.offeredAmount, locale)}
              </span>
            </div>
            <p className="mt-1 text-caption text-fg-muted">{t("jobs.apply.compensationNote")}</p>
          </div>

          <LabeledField
            label={t("jobs.apply.noteLabel")}
            htmlFor="note"
            hint={t("jobs.apply.noteHint")}
            error={state.fieldErrors?.note ? t(state.fieldErrors.note) : undefined}
          >
            <Textarea
              id="note"
              name="note"
              rows={4}
              maxLength={1000}
              placeholder={t("jobs.apply.notePlaceholder")}
            />
          </LabeledField>

          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}
