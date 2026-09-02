"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { Badge, ProgressMeter } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/data-table";
import { formatDateTime, formatPercent } from "@/lib/ui/format";

/**
 * The display vocabulary shared by every work surface — the installer's My Work,
 * their assignment detail, and the poster's awarded panel.
 *
 * It is one file rather than three copies because the same three facts are
 * rendered on all three screens: how far the work has got, whether that figure
 * means somebody is now waiting on somebody else, and which organization and
 * trade this engagement belongs to. A second implementation of any of them would
 * eventually disagree about the one thing that must not vary — what 100 percent
 * means.
 */

/**
 * The colour of a progress figure, and it changes at exactly one boundary.
 *
 * Accent while the work is moving, SUCCESS once it has been reported as
 * finished — but success here is the claim being complete, never the engagement
 * being complete. Nothing paints an assignment green because the number reached
 * 100; only `completed` does that, and it does it through the status badge.
 */
export function progressTone(percent: number, status: string | null): "accent" | "success" {
  if (status === "completed") return "success";
  return percent >= 100 ? "success" : "accent";
}

/**
 * The progress figure with its meter and the time it was reported.
 *
 * The timestamp is not decoration. A bare "60%" on a work record is unfalsifiable
 * — it could be from this morning or from three weeks ago — and the difference is
 * the whole reason a poster opens the page.
 */
export function WorkProgress({
  percent,
  lastAt,
  status,
  locale,
  size = "md",
}: {
  percent: number;
  lastAt: string | null;
  status: string | null;
  locale: Locale;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="text-label text-fg-muted">{t("work.progress.current")}</span>
        <span className="text-title font-semibold tabular-nums text-fg">
          {formatPercent(percent, locale)}
        </span>
      </div>
      <ProgressMeter
        value={percent}
        label={t("work.progress.current")}
        tone={progressTone(percent, status)}
        size={size}
      />
      <p className="text-label text-fg-muted">
        {lastAt
          ? `${t("work.progress.lastUpdate")}: ${formatDateTime(lastAt, locale)}`
          : t("work.featured.noUpdate")}
      </p>
    </div>
  );
}

/**
 * §14 ON SCREEN. Reached 100, still `in_progress`, and the next move is not the
 * installer's.
 *
 * The wording is the load-bearing part. "You reported this work as finished" is
 * a statement about what the reader did; anything shaped like "work complete"
 * would describe a state only the organization can bring about, and would make
 * the absence of a completion button read as a missing feature rather than as
 * the rule.
 */
export function ReadyForConfirmation() {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-success/40 bg-success/10 px-md py-sm">
      <p className="text-body-lg font-medium text-fg">{t("work.ready.title")}</p>
      <p className="mt-0.5 text-body text-fg-secondary">{t("work.ready.body")}</p>
      <p className="mt-1 text-label text-fg-muted">{t("work.ready.noAction")}</p>
    </div>
  );
}

/** The same claim, compacted to a badge for a list row or a card header. */
export function ReadyBadge() {
  const { t } = useI18n();
  return <Badge tone="success">{t("work.ready.badge")}</Badge>;
}

/**
 * The job's identity block: who it is for, and what trade it was agreed as.
 *
 * THIS IS WHERE THE REFERENCE'S PROJECT PHOTOGRAPH WOULD HAVE GONE, and the
 * substitution is deliberate rather than a shortfall. There is no storage
 * foundation, no media column on any table in this domain, and no photograph a
 * real assignment could supply — so a stock image would be a picture of somebody
 * else's building presented as the reader's work. `Monogram` is the canonical
 * answer to exactly this problem: a deterministic identity mark built from a
 * name the record actually holds.
 */
export function JobIdentity({
  orgName,
  tradeKey,
  tradeRetired,
  size = 44,
}: {
  orgName: string;
  tradeKey: string | null;
  tradeRetired?: boolean;
  size?: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Monogram name={orgName} size={size} />
      <div className="min-w-0">
        <p dir="auto" className="truncate text-body-lg font-medium text-fg">{orgName}</p>
        {tradeKey ? (
          <p className="truncate text-label text-fg-muted">
            {tradeLabel(t, tradeKey)}
            {/* §24. The label survives retirement; the fact that it retired is
                said once, quietly, and never by hiding the trade. */}
            {tradeRetired ? ` · ${t("jobs.hint.tradeRetired")}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled figure for the dense metric rows the reference uses. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-label text-fg-muted">{label}</span>
      <span className="truncate text-body font-medium text-fg">{children ?? "—"}</span>
    </div>
  );
}
