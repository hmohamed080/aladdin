"use client";

import { useI18n } from "@/lib/i18n/context";
import { Card, StatePanel, InlineError } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MapPinIcon, BriefcaseIcon } from "@/components/ui/icons";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatMoney, formatDate } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import { ApplicationStatusBadge, JobStatusBadge, DecisionReason } from "./badges";
import { withdrawApplicationAction } from "@/server/actions/application-forms";
import type { FormState } from "@/server/actions/job-forms";
import type { MyApplicationRow } from "@/server/queries/job-opportunities";

/**
 * "What have I applied to, and what happened?"
 *
 * APPLICATION STATE IS THE PRIMARY STATE (§23). The badge that leads each row is
 * the candidacy's, never the job's — a rejected application does not become
 * ambiguous because the job it was for later became Awarded, and an accepted one
 * does not read as finished because the job later completed. The job's own state
 * appears only as a quiet supporting line, and only when it says something the
 * application state does not.
 *
 * WHAT IS NOT HERE. No sibling applicants, no applicant counts, no ranking, and
 * no "you were 2nd choice" — the read seam has none of it and the poster's side
 * deliberately does not publish it.
 *
 * THE BRIDGE (§20). An accepted candidacy now offers its assignment, and the id
 * is RESOLVED rather than guessed: `assignmentIds` is keyed by
 * `job_assignments.application_id`, the foreign key `job_application_accept`
 * writes once, read back through the caller's own projection. Deriving a route
 * from the application id and hoping would produce a link that 404s the moment
 * the two ever differ. A rejected or withdrawn candidacy has no assignment and
 * gets no link, because there is nothing for the map to contain.
 */

export function MyApplications({
  applications,
  discoverableJobIds,
  assignmentIds,
  locale,
  filtered,
}: {
  applications: readonly MyApplicationRow[];
  /** applicationId -> assignmentId, for accepted candidacies only (§20). */
  assignmentIds?: ReadonlyMap<string, string>;
  /** Jobs still open AND still from a verified poster — the reapply gate. */
  discoverableJobIds: ReadonlySet<string>;
  locale: Locale;
  filtered: boolean;
}) {
  const { t } = useI18n();

  if (applications.length === 0) {
    return (
      <StatePanel
        icon={<BriefcaseIcon size={20} />}
        title={t(filtered ? "jobs.applications.noneInState" : "jobs.applications.emptyTitle")}
        body={t(filtered ? "jobs.applications.noneInStateBody" : "jobs.applications.emptyBody")}
        action={
          <ButtonLink href="/home/jobs" variant="primary" size="sm">
            {t("jobs.applications.browse")}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-md">
      {applications.map((a) => (
        <li key={a.id}>
          <ApplicationCard
            application={a}
            jobIsDiscoverable={Boolean(a.job_id && discoverableJobIds.has(a.job_id))}
            assignmentId={(a.id && assignmentIds?.get(a.id)) || null}
            locale={locale}
          />
        </li>
      ))}
    </ul>
  );
}

function ApplicationCard({
  application: a,
  jobIsDiscoverable,
  assignmentId,
  locale,
}: {
  application: MyApplicationRow;
  jobIsDiscoverable: boolean;
  /** Non-null only for an accepted candidacy whose assignment resolved. */
  assignmentId: string | null;
  locale: Locale;
}) {
  const { t } = useI18n();
  const place = [a.city, a.governorate].filter(Boolean).join(", ");
  const canWithdraw = a.status === "submitted";
  // §12: the SAME two gates the RPC applies to a withdrawn row.
  const canReapply = a.status === "withdrawn" && jobIsDiscoverable;

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <h3 className="text-title text-fg">{a.job_title}</h3>
          {a.poster_org_name ? (
            <p className="mt-0.5 text-caption text-fg-secondary">{a.poster_org_name}</p>
          ) : null}
        </div>
        {a.status ? <ApplicationStatusBadge status={a.status} /> : null}
      </div>

      <ul className="flex flex-wrap gap-x-md gap-y-1.5 text-caption text-fg-secondary">
        {a.trade_key ? (
          <li className="flex items-center gap-1.5">
            <BriefcaseIcon size={14} className="shrink-0 text-fg-muted" />
            {/* Reads through `my_job_applications`, which does NOT filter on
                trades.is_active — so a trade retired after the fact keeps its
                label here, exactly as Increment 7 established for the poster. */}
            {tradeLabel(t, a.trade_key)}
          </li>
        ) : null}
        {place ? (
          <li className="flex items-center gap-1.5">
            <MapPinIcon size={14} className="shrink-0 text-fg-muted" />
            {place}
          </li>
        ) : null}
        <li className="font-medium text-fg">{formatMoney(a.offered_amount, locale)}</li>
        {a.created_at ? (
          <li>{t("jobs.applications.appliedOn", { date: formatDate(a.created_at, locale) })}</li>
        ) : null}
      </ul>

      {/* The decided states, each said in its own words. "You withdrew" and
          "you were not selected" are different facts about the same person and
          must never render as the same neutral row (§17). */}
      {a.status === "accepted" ? (
        <div className="flex flex-col items-start gap-sm rounded-md border border-success/30 bg-success/10 p-md">
          <div>
            <p className="text-body font-medium text-fg">{t("jobs.applications.accepted.title")}</p>
            <p className="text-caption text-fg-secondary">{t("jobs.applications.accepted.body")}</p>
          </div>
          {/* Offered only where an assignment genuinely resolved. */}
          {assignmentId ? (
            <ButtonLink href={`/home/work/${assignmentId}`} variant="accent" size="sm">
              {t("work.viewInWork")}
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      {a.status === "rejected" ? (
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium text-fg">{t("jobs.applications.rejected.title")}</p>
          {a.decision_reason ? (
            <p className="text-caption text-fg-secondary">
              <span className="text-fg-muted">{t("jobs.applications.reason")}: </span>
              <DecisionReason reason={a.decision_reason} />
            </p>
          ) : null}
        </div>
      ) : null}

      {a.status === "withdrawn" ? (
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium text-fg">{t("jobs.applications.withdrawn.title")}</p>
          {!canReapply ? (
            <p className="text-caption text-fg-secondary">
              {t("jobs.applications.withdrawn.closed")}
            </p>
          ) : null}
        </div>
      ) : null}

      {a.note ? (
        <div>
          <p className="text-label font-medium text-fg-muted">{t("jobs.applications.yourNote")}</p>
          <p className="max-w-prose whitespace-pre-line text-body text-fg-secondary">{a.note}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-sm">
        {/* Supporting context, never the headline. Suppressed while the job is
            still open, where it would only repeat what the badge already says. */}
        <p className="text-caption text-fg-muted">
          {a.job_status && a.job_status !== "open" ? (
            <span className="inline-flex items-center gap-1.5">
              <JobStatusBadge status={a.job_status} />
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-sm">
          {/* One link, two labels. Re-applying goes through the SAME opening
              page as any other application, so the reader re-reads the amount
              and the trade before sending it again — a one-tap "apply again"
              from a list is how somebody re-commits to terms they last saw
              weeks ago. Two buttons to the same href would be noise. */}
          {jobIsDiscoverable && a.job_id ? (
            <ButtonLink
              href={`/home/jobs/${a.job_id}`}
              variant={canReapply ? "accent" : "outline"}
              size="sm"
            >
              {t(canReapply ? "jobs.apply.againAction" : "jobs.applications.viewJob")}
            </ButtonLink>
          ) : null}

          {canWithdraw ? (
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
                  <input type="hidden" name="applicationId" value={a.id ?? ""} />
                  <input type="hidden" name="jobId" value={a.job_id ?? ""} />
                  {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
                </>
              )}
            </ConfirmDialog>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
