"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Card, ProgressMeter } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { BriefcaseIcon } from "@/components/ui/icons";
import { AssignmentStatusBadge } from "@/features/jobs/badges";
import { formatPercent } from "@/lib/ui/format";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { readyForCompletion } from "@/lib/work/assignment-state";
import { ReadyBadge } from "@/features/work/parts";

/**
 * The ONE My Work integration `/home` gains this increment (§21).
 *
 * NOT the Installer dashboard redesign — that is Increment 14, and this page
 * still leads with the professional's own record exactly as it did. What changes
 * is that the first thing a working professional sees is the work they are
 * actually doing, rather than a profile-completeness prompt about a profile they
 * already filled in.
 *
 * IT IS ONE ASSIGNMENT OR IT IS AN ENTRY POINT, and nothing in between. No
 * counts, no list, no "3 jobs waiting", no board preview — the reference's home
 * dashboard has all of those and every one would need either a figure this page
 * does not read or an invented one. The compact empty state is a link, which is
 * the honest version of the same block.
 *
 * The read behind it is the same `my_job_assignments` projection every other
 * work surface uses, resolved server-side and passed in; this component fetches
 * nothing.
 */
export function CurrentWorkBlock({
  assignment,
  locale,
}: {
  /** The featured current assignment, or null when there is none. */
  assignment: MyAssignmentRow | null;
  locale: Locale;
}) {
  const { t } = useI18n();

  if (!assignment) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="text-fg-muted">
            <BriefcaseIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-fg">{t("work.home.none")}</p>
            <p className="text-label text-fg-muted">{t("work.home.noneBody")}</p>
          </div>
        </div>
        <ButtonLink href="/home/jobs" variant="outline" size="sm">
          {t("work.browse")}
        </ButtonLink>
      </Card>
    );
  }

  const percent = assignment.latest_progress_percent ?? 0;

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          {/* No eyebrow: the section heading above already says "Current work",
              and repeating it here printed the same two words twice in a row. */}
          <h3 dir="auto" className="truncate text-title text-fg">{assignment.job_title}</h3>
          <p dir="auto" className="truncate text-body text-fg-secondary">{assignment.poster_org_name}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {readyForCompletion(assignment) ? <ReadyBadge /> : null}
          <AssignmentStatusBadge status={assignment.status ?? "scheduled"} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-sm">
          <span className="text-label text-fg-muted">{t("work.progress.current")}</span>
          <span className="text-body-lg font-semibold tabular-nums text-fg">
            {formatPercent(percent, locale)}
          </span>
        </div>
        <ProgressMeter
          value={percent}
          label={t("work.progress.current")}
          tone={percent >= 100 ? "success" : "accent"}
          size="sm"
        />
      </div>

      <div className="flex flex-wrap gap-sm">
        <ButtonLink href={`/home/work/${assignment.id}`} variant="accent" size="sm">
          {t("work.viewDetails")}
        </ButtonLink>
        <ButtonLink href="/home/work" variant="outline" size="sm">
          {t("work.home.view")}
        </ButtonLink>
      </div>
    </Card>
  );
}
