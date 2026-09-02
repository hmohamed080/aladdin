"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { tradeLabel } from "@/lib/i18n/trade-label";
import {
  publishJobAction,
  closeJobAction,
  cancelJobAction,
  type FormState,
} from "@/server/actions/job-forms";
import { Card, SectionTitle, Field, StatePanel, InlineError } from "@/components/ui/primitives";
import { ButtonLink, Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { JobStatusBadge } from "@/features/jobs/badges";
import { PosterAssignmentPanel } from "@/features/work/poster-panel";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { useActionState } from "react";
import type { JobListRow, JobAssignmentRow } from "@/server/queries/jobs";
import type { ProgressUpdateRow } from "@/server/queries/job-assignments";

const initial: FormState = { ok: false };

export type JobRole = {
  /** job.post or org.manage — may author, publish, close and cancel. */
  canPost: boolean;
  /** job.manage or org.manage — may decide applications. */
  canManage: boolean;
  /** The poster organization's live verification state. */
  orgVerified: boolean;
};

/**
 * The poster's operational view of one opening.
 *
 * HIERARCHY, top to bottom: what this job is → what state it is in → the offer
 * and the work → who has applied → the lifecycle actions that end it. That order
 * is deliberate and it is not a marketplace card: a poster opening this page is
 * either checking on recruitment or deciding something, and the destructive
 * actions sit last because they are the least likely reason to be here.
 *
 * WHAT IS ABSENT, AND WHY. There is no way to REPORT progress and no review
 * control. Reporting is the assigned professional's alone — `job_progress_add`
 * refuses anyone else — so this side reads the history and cannot add to it. What
 * Increment 9 did add is the completion the poster genuinely owns, inside
 * `PosterAssignmentPanel`: the installer signals readiness, and confirming it is
 * this organization's move and nobody else's.
 */
export function JobDetail({
  job,
  assignee,
  assignment,
  progress,
  role,
  locale,
}: {
  job: JobListRow;
  assignee: string | null;
  assignment: JobAssignmentRow | null;
  /** The professional's own reports. Read-only on this side (§16). */
  progress: readonly ProgressUpdateRow[];
  role: JobRole;
  locale: Locale;
}) {
  const { t } = useI18n();

  const isDraft = job.status === "draft";
  const isOpen = job.status === "open";
  const isAwarded = job.status === "awarded";
  // Content is editable only while the opening is still being recruited for.
  // Past that the contract is settled and `job_update` refuses regardless.
  const editable = (isDraft || isOpen) && role.canPost;

  return (
    <div className="flex flex-col gap-lg">
      {/* 1. Identity and state. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{job.title}</h1>
              <JobStatusBadge status={job.status} />
            </div>
            <p className="text-body text-fg-secondary">
              {job.tradeKey ? tradeLabel(t, job.tradeKey) : "—"}
              {/* The trade this job was posted in still reads as itself after the
                  platform retires it — `job_trade_labels` is what keeps the label
                  legible. But it is history, not a choice still on offer, and a
                  DRAFT under one can never be published: saying so here is the
                  difference between "why is Publish refusing me" and a sentence
                  that answers it. */}
              {job.tradeRetired ? (
                <span className="text-caption text-fg-muted"> · {t("jobs.hint.tradeRetired")}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-sm">
            {editable ? (
              <ButtonLink href={`/b2b/jobs/${job.id}/edit`} variant="outline" size="sm">
                {t("jobs.edit")}
              </ButtonLink>
            ) : null}
            {/* The applicants queue is reachable from any state that could have
                one — including closed and awarded, where the record of who
                applied still matters. It is NOT shown on a draft, which cannot
                have applicants by construction. */}
            {!isDraft ? (
              <ButtonLink href={`/b2b/jobs/${job.id}/applicants`} variant="accent" size="sm">
                {t("jobs.viewApplications")}
                {job.applicationCount > 0 ? ` (${job.applicationCount})` : ""}
              </ButtonLink>
            ) : null}
          </div>
        </div>

        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("jobs.field.offer")}>{formatMoney(job.offered_amount, locale)}</Field>
          <Field label={t("jobs.field.location")}>
            {[job.city, job.governorate].filter(Boolean).join(", ") || "—"}
          </Field>
          <Field label={t("jobs.field.duration")}>
            {job.expected_duration_days != null
              ? t("jobs.days", { count: String(job.expected_duration_days) })
              : "—"}
          </Field>
          <Field label={t("jobs.field.applications")}>{job.applicationCount}</Field>
        </dl>
      </Card>

      {/* 2. Awarded — who holds the work, how far it has got, and the two moves
             this side of the engagement owns.
             Increment 9 replaced the read-only summary that stood here. What it
             did NOT do is grow a second work-management product: this is one
             panel on the existing job detail, and every control on it calls an
             RPC that already existed. */}
      {isAwarded || job.status === "completed" ? (
        <PosterAssignmentPanel
          assignment={assignment}
          assignee={assignee}
          updates={progress}
          canManage={role.canManage}
          locale={locale}
        />
      ) : null}

      {/* 3. The work itself. */}
      <Card>
        <SectionTitle>{t("jobs.field.description")}</SectionTitle>
        <p className="mt-sm whitespace-pre-line text-body text-fg-secondary">
          {job.description || "—"}
        </p>
        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-4">
          <Field label={t("jobs.field.schedule")}>
            {job.starts_on ? formatDate(job.starts_on, locale) : "—"}
            {job.ends_by ? ` → ${formatDate(job.ends_by, locale)}` : ""}
          </Field>
          {/* Shown to the POSTER only. It never leaves this side until the job is
              awarded, and no discovery projection carries it. */}
          <Field label={t("jobs.field.siteAddress")}>{job.site_address || "—"}</Field>
          <Field label={t("jobs.field.created")}>{formatDate(job.created_at, locale)}</Field>
          <Field label={t("jobs.field.published")}>
            {job.published_at ? formatDate(job.published_at, locale) : "—"}
          </Field>
        </dl>
      </Card>

      {/* 4. Lifecycle. Only what this state and this caller can actually do. */}
      {role.canPost ? (
        <Card>
          <SectionTitle>{t("common.actions")}</SectionTitle>

          {isDraft ? (
            role.orgVerified ? (
              <div className="mt-md flex flex-col gap-sm">
                <p className="text-body text-fg-secondary">{t("jobs.publish.body")}</p>
                <p className="text-label text-fg-muted">{t("jobs.publish.offerWarning")}</p>
                <div className="flex flex-wrap gap-sm">
                  <PublishForm jobId={job.id} version={job.version} />
                  <CancelDialog jobId={job.id} version={job.version} />
                </div>
              </div>
            ) : (
              /* The genuine requirement, named — and a route to the one thing
                 that fixes it. No bypass, and no pretending the button would
                 work. */
              <div className="mt-md flex flex-col gap-sm">
                <StatePanel
                  tone="warning"
                  title={t("jobs.publish.unverifiedTitle")}
                  body={t("jobs.publish.unverifiedBody")}
                />
                <div className="flex flex-wrap items-center gap-md">
                  <Link
                    href="/b2b/organization"
                    className="text-label font-medium text-accent hover:underline"
                  >
                    {t("jobs.publish.unverifiedLink")} →
                  </Link>
                  <CancelDialog jobId={job.id} version={job.version} />
                </div>
              </div>
            )
          ) : null}

          {isOpen ? (
            <div className="mt-md flex flex-wrap gap-sm">
              <CloseDialog jobId={job.id} version={job.version} />
              <CancelDialog jobId={job.id} version={job.version} />
            </div>
          ) : null}

          {/* THE TWO-STEP INVARIANT, on screen. An awarded job cannot be
              cancelled — the assignment has to end first, which returns the job
              to open. Rendering a Cancel button here would be offering an action
              that is guaranteed to fail, so the rule is stated instead; the
              control that DOES end the assignment is in the awarded panel
              above. */}
          {isAwarded ? (
            <p className="mt-md text-body text-fg-secondary">{t("jobs.awarded.cancelBlocked")}</p>
          ) : null}

          {!isDraft && !isOpen && !isAwarded ? (
            <p className="mt-md text-body text-fg-secondary">{t("jobs.awarded.readOnly")}</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function PublishForm({ jobId, version }: { jobId: string; version: number }) {
  const { t } = useI18n();
  const [state, action] = useActionState(publishJobAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("jobs.publish.action")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CloseDialog({ jobId, version }: { jobId: string; version: number }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("jobs.close.action")}
      triggerVariant="outline"
      title={t("jobs.close.title")}
      body={t("jobs.close.body")}
      confirmLabel={t("jobs.close.confirm")}
      formAction={closeJobAction}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="expectedVersion" value={version} />
    </ConfirmDialog>
  );
}

function CancelDialog({ jobId, version }: { jobId: string; version: number }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("jobs.cancelJob.action")}
      title={t("jobs.cancelJob.title")}
      body={t("jobs.cancelJob.body")}
      confirmLabel={t("jobs.cancelJob.confirm")}
      formAction={cancelJobAction}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <div className="mt-sm">
        <LabeledField label={t("jobs.cancelJob.reason")} htmlFor={`reason-${jobId}`}>
          <Input id={`reason-${jobId}`} name="reason" maxLength={500} />
        </LabeledField>
      </div>
    </ConfirmDialog>
  );
}
