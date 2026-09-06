"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Card, Field, SectionTitle } from "@/components/ui/primitives";
import { UsersIcon } from "@/components/ui/icons";
import { AssignmentStatusBadge } from "@/features/jobs/badges";
import { formatDate, formatDateTime, formatMoney, formatPercent } from "@/lib/ui/format";
import type { JobAssignmentRow } from "@/server/queries/jobs";
import type { ProgressUpdateRow } from "@/server/queries/job-assignments";
import { WorkProgress, ReadyBadge } from "./parts";
import { ConfirmCompletionForm, EndAssignmentDialog } from "./lifecycle";

/**
 * The POSTING ORGANIZATION's view of the work it awarded — an extension to the
 * existing job detail, not a second work-management product (§15).
 *
 * It replaces the read-only "assigned to" summary Increment 7 shipped with a
 * deliberate placeholder note ("active work management is Increment 9's
 * surface"). Everything that was there is still here; what is added is the
 * progress the professional has reported, the readiness state, and the two
 * actions this side of the engagement actually holds.
 *
 * THE ASYMMETRY IS THE POINT AND IT RUNS BOTH WAYS.
 *
 *   * Completion is HERE and only here. `job_assignment_complete` refuses any
 *     caller who is not a `job.manage` holder in the posting organization, and
 *     the installer's surfaces import no action that could call it.
 *   * Progress reporting is THERE and only there. `job_progress_add` refuses
 *     anyone but the assigned installer, so this panel reads the history and
 *     offers no way to add to it. A poster who could write progress would be
 *     writing the professional's account of their own work.
 *
 * Cancellation is the one action both sides hold, and it is worded from this
 * side: the organization gets its opening back, and applications already
 * declined stay declined.
 */
export function PosterAssignmentPanel({
  assignment,
  assignee,
  updates,
  canManage,
  locale,
}: {
  assignment: JobAssignmentRow | null;
  /** From the Increment 7 applicants projection — the one authorized identity. */
  assignee: string | null;
  updates: readonly ProgressUpdateRow[];
  /** job.manage or org.manage. Read-only for a colleague without it. */
  canManage: boolean;
  locale: Locale;
}) {
  const { t } = useI18n();

  if (!assignment) {
    return (
      <Card>
        <SectionTitle>{t("jobs.awarded.assignedTo")}</SectionTitle>
        <div className="mt-md flex items-center gap-2.5">
          <UsersIcon size={18} />
          <span className="text-body-lg font-medium text-fg">{assignee ?? "—"}</span>
        </div>
      </Card>
    );
  }

  const percent = assignment.latest_progress_percent ?? 0;
  const ready = assignment.status === "in_progress" && percent >= 100;
  const live = assignment.status === "scheduled" || assignment.status === "in_progress";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex items-center gap-2.5">
          <UsersIcon size={18} />
          <div className="min-w-0">
            <p className="text-label text-fg-muted">{t("jobs.awarded.assignedTo")}</p>
            <p className="truncate text-body-lg font-medium text-fg">{assignee ?? "—"}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {ready ? <ReadyBadge /> : null}
          <AssignmentStatusBadge status={assignment.status} />
        </div>
      </div>

      <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-4">
        <Field label={t("jobs.awarded.agreed")}>
          {formatMoney(assignment.agreed_amount, locale)}
        </Field>
        <Field label={t("work.detail.startedOn")}>
          {formatDate(assignment.started_at, locale) || "—"}
        </Field>
        <Field label={t("work.detail.completedOn")}>
          {formatDate(assignment.completed_at, locale) || "—"}
        </Field>
        <Field label={t("work.detail.cancelledOn")}>
          {formatDate(assignment.cancelled_at, locale) || "—"}
        </Field>
      </dl>

      {/* ---- The progress, read-only on this side ---- */}
      <div className="mt-md border-t pt-md">
        <h3 className="text-body-lg font-medium text-fg">{t("work.poster.progressTitle")}</h3>
        {assignment.status === "scheduled" ? (
          <p className="mt-sm text-body text-fg-secondary">{t("work.poster.notStarted")}</p>
        ) : (
          <div className="mt-sm max-w-md">
            <WorkProgress
              percent={percent}
              lastAt={assignment.last_progress_at}
              status={assignment.status}
              locale={locale}
            />
          </div>
        )}

        {/* §14 from the other side. The organization is told a CLAIM was made
            and that confirming it is theirs — never that the work "is" done. */}
        {ready ? (
          <div className="mt-md rounded-md border border-success/40 bg-success/10 px-md py-sm">
            <p className="text-body-lg font-medium text-fg">{t("work.poster.readyTitle")}</p>
            <p className="mt-0.5 text-body text-fg-secondary">{t("work.poster.readyBody")}</p>
          </div>
        ) : null}

        {updates.length > 0 ? (
          <ol className="mt-md flex flex-col gap-sm">
            {updates.map((u) => (
              <li
                key={u.id}
                className="flex gap-sm rounded-md border bg-surface-2/30 px-md py-sm"
              >
                <span className="shrink-0 text-body-lg font-semibold tabular-nums text-fg">
                  {formatPercent(u.progress_percent, locale)}
                </span>
                <div className="min-w-0 flex-1">
                  {u.stage ? (
                    <p className="truncate text-body font-medium text-fg">{u.stage}</p>
                  ) : null}
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
        ) : assignment.status !== "scheduled" ? (
          <p className="mt-sm text-label text-fg-muted">{t("work.poster.noProgress")}</p>
        ) : null}
      </div>

      {/* ---- The two actions this side holds ---- */}
      {canManage && live ? (
        <div className="mt-md flex flex-col gap-sm border-t pt-md">
          <p className="text-label text-fg-muted">{t("work.complete.hint")}</p>
          <div className="flex flex-wrap gap-sm">
            {/* Completion is only reachable from `in_progress` — the RPC refuses
                a scheduled assignment, so the control is not offered on one. */}
            {assignment.status === "in_progress" ? (
              <ConfirmCompletionForm
                assignmentId={assignment.id}
                jobId={assignment.job_id}
                version={assignment.version}
              />
            ) : null}
            <EndAssignmentDialog
              assignmentId={assignment.id}
              jobId={assignment.job_id}
              version={assignment.version}
            />
          </div>
        </div>
      ) : null}

      {/* §19 from this side too: the reason is kept and shown. */}
      {assignment.cancellation_reason ? (
        <div className="mt-md border-t pt-md">
          <Field label={t("work.detail.cancellationReason")}>
            {assignment.cancellation_reason}
          </Field>
        </div>
      ) : null}
    </Card>
  );
}
