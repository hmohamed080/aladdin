"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { ButtonLink } from "@/components/ui/controls";
import { AssignmentStatusBadge } from "@/features/jobs/badges";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { MapPinIcon } from "@/components/ui/icons";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { canReportProgress, canStart, readyForCompletion } from "@/lib/work/assignment-state";
import { JobIdentity, Metric, ReadyBadge, WorkProgress } from "./parts";
import { ReportProgressDialog, StartWorkDialog } from "./lifecycle";

/**
 * THE FEATURED CURRENT ASSIGNMENT — the reference's large current-work area,
 * rebuilt out of facts this domain actually holds.
 *
 * WHAT IS INHERITED FROM `03-my-work.jpeg`: the composition. A single dominant
 * block above the historical list, split into an identity/detail side and a
 * progress/action side, with a dense metric row across the middle and the one
 * action the reader is most likely here to take rendered as the primary control.
 *
 * WHAT IS NOT: the project photograph (no storage foundation, and a stock image
 * would be a picture of somebody else's building presented as this person's
 * work), the client star rating (no reviews until Increment 12), the "running
 * now" chip duplicating the status badge, and the appointment/materials/messages
 * controls, none of which have authority behind them.
 *
 * The photo slot is not left empty — that is what would turn a designed block
 * into a gap. It carries `JobIdentity`, which is the same organization identity
 * the list rows use, at a size that anchors the card.
 */
export function CurrentWork({
  assignment,
  locale,
}: {
  assignment: MyAssignmentRow;
  locale: Locale;
}) {
  const { t } = useI18n();
  const a = assignment;
  const id = a.id ?? "";
  const percent = a.latest_progress_percent ?? 0;
  const ready = readyForCompletion(a);
  const location = [a.city, a.governorate].filter(Boolean).join(", ");

  return (
    <section
      aria-labelledby={`current-${id}`}
      className="overflow-hidden rounded-md border bg-surface shadow-card"
    >
      {/* The band is what makes this block read as the page's subject rather
          than as the first of N cards. Tone only — no new elevation, no new
          radius, no border weight of its own. */}
      <div className="flex flex-wrap items-center justify-between gap-sm border-b bg-accent-solid/10 px-md py-2.5">
        <p className="text-label font-medium text-accent">{t("work.featured.eyebrow")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {ready ? <ReadyBadge /> : null}
          <AssignmentStatusBadge status={a.status ?? "scheduled"} />
        </div>
      </div>

      <div className="grid gap-lg p-md desktop:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ---- Identity and terms ---- */}
        <div className="flex min-w-0 flex-col gap-md">
          <div className="min-w-0">
            <h2 id={`current-${id}`} dir="auto" className="text-title font-semibold text-fg">
              {a.job_title}
            </h2>
            {location ? (
              <p className="mt-1 flex items-center gap-1.5 text-body text-fg-secondary">
                <span aria-hidden="true" className="text-fg-muted">
                  <MapPinIcon size={15} />
                </span>
                {location}
              </p>
            ) : null}
          </div>

          <JobIdentity
            orgName={a.poster_org_name ?? "—"}
            tradeKey={a.trade_key}
            tradeRetired={a.trade_is_active === false}
          />

          <dl className="grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-3">
            <Metric label={t("work.featured.agreed")}>
              {formatMoney(a.agreed_amount, locale)}
            </Metric>
            <Metric label={t("work.featured.schedule")}>
              {a.starts_on ? formatDate(a.starts_on, locale) : "—"}
              {a.ends_by ? ` → ${formatDate(a.ends_by, locale)}` : ""}
            </Metric>
            <Metric label={t("work.detail.assignedOn")}>
              {formatDate(a.created_at, locale)}
            </Metric>
          </dl>
        </div>

        {/* ---- Progress and the one action ---- */}
        <div className="flex min-w-0 flex-col justify-between gap-md rounded-md border bg-surface-2/30 p-md">
          <WorkProgress
            percent={percent}
            lastAt={a.last_progress_at}
            status={a.status}
            locale={locale}
          />

          <div className="flex flex-wrap gap-sm">
            {/* Exactly the action the current state permits, and no placeholder
                for the others. `canStart` and `canReportProgress` mirror the
                RPCs' own guards, so a control shown here is one the database
                would accept. */}
            {canStart(a) ? <StartWorkDialog assignmentId={id} version={a.version ?? 1} /> : null}
            {canReportProgress(a) ? (
              <ReportProgressDialog
                assignmentId={id}
                jobId={a.job_id ?? ""}
                current={percent}
              />
            ) : null}
            <ButtonLink href={`/home/work/${id}`} variant="outline">
              {t("work.viewDetails")}
            </ButtonLink>
          </div>

          {/* §14, compact. The full statement lives on the detail page; here it
              is the one line that explains why there is no further button. */}
          {ready ? (
            <p className="text-label text-fg-muted">{t("work.ready.body")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
