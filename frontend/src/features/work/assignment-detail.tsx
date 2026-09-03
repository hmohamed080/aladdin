"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Card, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { AssignmentStatusBadge } from "@/features/jobs/badges";
import { formatDate, formatDateTime, formatMoney, formatPercent } from "@/lib/ui/format";
import type { MyAssignmentRow, ProgressUpdateRow } from "@/server/queries/job-assignments";
import { canCancel, canReportProgress, canStart, readyForCompletion } from "@/lib/work/assignment-state";
import { JobIdentity, ReadyForConfirmation, WorkProgress } from "./parts";
import { CancelAssignmentDialog, ReportProgressDialog, StartWorkDialog } from "./lifecycle";
import { AssignmentReview } from "@/features/reviews/assignment-review";

/**
 * The installer's operational record for ONE assignment.
 *
 * HIERARCHY, top to bottom (§10): what this work is and who it is for → the
 * state it is in → the terms and the schedule → progress, and its history → the
 * one lifecycle action this state permits. Destructive last, as on the poster's
 * job detail, because ending an engagement is the least likely reason to be
 * here.
 *
 * WHAT IS ABSENT AND MUST STAY ABSENT:
 *
 *   * a completion control. `job_assignment_complete` refuses any caller who is
 *     not a `job.manage` holder in the posting organization, and there is no
 *     installer-side action in `assignment-forms.ts` that could call it. The
 *     absence here is structural, not a hidden button.
 *   * every other applicant. This surface reads `my_job_assignments`, which
 *     returns the caller's own engagements and nothing else — there is no
 *     competing candidacy in scope to leak.
 *   * poster-side management. No publish, edit, close, cancel-the-JOB or
 *     applicant queue; those are `/b2b/jobs` and are a different authority.
 *   * reviews. Increment 12.
 */
export function AssignmentDetail({
  assignment,
  updates,
  review,
  locale,
}: {
  assignment: MyAssignmentRow;
  updates: readonly ProgressUpdateRow[];
  /**
   * The organization's review of this work, if they have written one.
   *
   * NULL IS SILENT (§11). When no review exists this page says nothing at all —
   * no "not reviewed yet", no prompt, no request button. The professional cannot
   * make a client write one, and a line telling them it is missing would be a
   * standing reminder of something outside their control on the record of work
   * they already finished.
   */
  review: { rating: number; comment: string | null; createdAt: string } | null;
  locale: Locale;
}) {
  const { t } = useI18n();
  const a = assignment;
  const id = a.id ?? "";
  const jobId = a.job_id ?? "";
  const percent = a.latest_progress_percent ?? 0;
  const ready = readyForCompletion(a);
  const location = [a.city, a.governorate].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-md">
      {review ? <AssignmentReview review={review} locale={locale} /> : null}

      {/* ---- 1. Identity and state ---- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <p className="text-label text-fg-muted">{t("work.detail.eyebrow")}</p>
            <h1 dir="auto" className="mt-0.5 text-headline text-fg">{a.job_title}</h1>
            {/* The organization is named ONCE on this page, by the identity
                block below — which also carries the trade and the mark. A
                "Posted by: X" line here repeated it on the very next line, which
                is the same redundancy Increment 8 removed from the opportunity
                card. */}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <AssignmentStatusBadge status={a.status ?? "scheduled"} />
          </div>
        </div>

        <div className="mt-md border-t pt-md">
          <JobIdentity
            orgName={a.poster_org_name ?? "—"}
            tradeKey={a.trade_key}
            tradeRetired={a.trade_is_active === false}
          />
          {/* §24 stated in full where there is room for it, rather than only as
              the badge-side hint the identity block carries. */}
          {a.trade_is_active === false ? (
            <p className="mt-sm text-label text-fg-muted">{t("work.detail.retiredTrade")}</p>
          ) : null}
        </div>

        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-4">
          <Field label={t("work.detail.agreed")}>{formatMoney(a.agreed_amount, locale)}</Field>
          <Field label={t("work.detail.location")}>{location || "—"}</Field>
          <Field label={t("work.detail.schedule")}>
            {a.starts_on ? formatDate(a.starts_on, locale) : "—"}
            {a.ends_by ? ` → ${formatDate(a.ends_by, locale)}` : ""}
          </Field>
          <Field label={t("work.detail.duration")}>
            {a.expected_duration_days != null
              ? t("jobs.days", { count: String(a.expected_duration_days) })
              : "—"}
          </Field>
        </dl>
      </Card>

      {/* ---- 2. The work itself, and the site ---- */}
      <Card>
        <SectionTitle>{t("work.detail.description")}</SectionTitle>
        <p className="mt-sm whitespace-pre-line text-body text-fg-secondary">
          {a.job_description || "—"}
        </p>
        <dl className="mt-md grid grid-cols-1 gap-md border-t pt-md tablet:grid-cols-2">
          {/* §11: the address is released to the professional who holds the
              work, and the projection withholds it again once the assignment is
              cancelled. Naming the rule is what turns the absence into an
              explanation rather than missing data. */}
          <Field label={t("work.detail.site")}>
            {a.site_address || (
              <span className="text-body text-fg-muted">{t("work.detail.siteWithheld")}</span>
            )}
          </Field>
          <Field label={t("work.detail.assignedOn")}>{formatDate(a.created_at, locale)}</Field>
        </dl>
      </Card>

      {/* ---- 3. Progress ---- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <SectionTitle>{t("work.progress.title")}</SectionTitle>
          {canReportProgress(a) ? (
            <ReportProgressDialog assignmentId={id} jobId={jobId} current={percent} />
          ) : null}
        </div>

        <div className="mt-md max-w-md">
          <WorkProgress
            percent={percent}
            lastAt={a.last_progress_at}
            status={a.status}
            locale={locale}
          />
        </div>

        {/* §14. The one place the rule is stated at full length. */}
        {ready ? (
          <div className="mt-md">
            <ReadyForConfirmation />
          </div>
        ) : null}

        {a.status === "scheduled" ? (
          <p className="mt-md text-label text-fg-muted">{t("work.progress.notStarted")}</p>
        ) : null}

        <div className="mt-lg border-t pt-md">
          <h3 className="text-body-lg font-medium text-fg">{t("work.progress.history")}</h3>
          {/* The rule belongs BESIDE the history it governs, not only inside the
              dialog that writes to it: the reader looking for an edit button is
              looking at this list, not at a form they have not opened. */}
          <p className="mt-0.5 text-label text-fg-muted">{t("work.progress.appendOnly")}</p>
          <ProgressHistory updates={updates} locale={locale} />
        </div>
      </Card>

      {/* ---- 4. The record: how this engagement moved ---- */}
      <Card>
        <SectionTitle>{t("work.detail.timeline")}</SectionTitle>
        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("work.detail.assignedOn")}>{formatDate(a.created_at, locale)}</Field>
          <Field label={t("work.detail.startedOn")}>
            {a.started_at ? formatDate(a.started_at, locale) : "—"}
          </Field>
          <Field label={t("work.detail.completedOn")}>
            {a.completed_at ? formatDate(a.completed_at, locale) : "—"}
          </Field>
          <Field label={t("work.detail.cancelledOn")}>
            {a.cancelled_at ? formatDate(a.cancelled_at, locale) : "—"}
          </Field>
        </dl>
        {/* §19. A cancelled assignment is a record, shown neutrally, with the
            reason the other party gave — never erased and never dressed up as
            work the reader completed. */}
        {a.cancellation_reason ? (
          <div className="mt-md border-t pt-md">
            <Field label={t("work.detail.cancellationReason")}>{a.cancellation_reason}</Field>
          </div>
        ) : null}
      </Card>

      {/* ---- 5. Lifecycle. Only what this state and this actor permit. ---- */}
      {canStart(a) || canCancel(a) ? (
        <Card>
          <SectionTitle>{t("common.actions")}</SectionTitle>
          {canStart(a) ? (
            <p className="mt-sm text-body text-fg-secondary">{t("work.start.hint")}</p>
          ) : null}
          <div className="mt-md flex flex-wrap gap-sm">
            {canStart(a) ? <StartWorkDialog assignmentId={id} version={a.version ?? 1} /> : null}
            {canCancel(a) ? (
              <CancelAssignmentDialog
                assignmentId={id}
                jobId={jobId}
                version={a.version ?? 1}
              />
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The append-only history.
 *
 * Rendered newest first as a list of stated facts, with no edit or delete
 * affordance anywhere — `job_progress_updates` carries `app.forbid_mutation()`
 * on both UPDATE and DELETE, and an affordance the database refuses is worse
 * than none. The copy says so once rather than per row.
 */
function ProgressHistory({
  updates,
  locale,
}: {
  updates: readonly ProgressUpdateRow[];
  locale: Locale;
}) {
  const { t } = useI18n();

  if (updates.length === 0) {
    return (
      <div className="mt-sm">
        <StatePanel title={t("work.progress.historyEmpty")} />
      </div>
    );
  }

  return (
    <ol className="mt-sm flex flex-col gap-sm">
      {updates.map((u) => (
        <li key={u.id} className="flex gap-sm rounded-md border bg-surface-2/30 px-md py-sm">
          <span className="shrink-0 text-body-lg font-semibold tabular-nums text-fg">
            {formatPercent(u.progress_percent, locale)}
          </span>
          <div className="min-w-0 flex-1">
            {u.stage ? <p className="truncate text-body font-medium text-fg">{u.stage}</p> : null}
            {u.note ? (
              <p className="whitespace-pre-line text-body text-fg-secondary">{u.note}</p>
            ) : null}
            <p className="mt-0.5 text-label text-fg-muted">
              {t("work.progress.at")}: {formatDateTime(u.created_at, locale)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
