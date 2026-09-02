"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Panel, PanelRow, WorkPane } from "@/components/ui/workspace-layout";
import { DataTable, RecordCell, Monogram, ListFooter } from "@/components/ui/data-table";
import { StatePanel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import Link from "next/link";
import { BriefcaseIcon, ClipboardIcon } from "@/components/ui/icons";
import { AssignmentStatusBadge } from "@/features/jobs/badges";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatDate, formatMoney } from "@/lib/ui/format";
import type { JobAssignmentStatus, MyAssignmentRow } from "@/server/queries/job-assignments";
import { featuredAssignment } from "@/lib/work/assignment-state";
import { CurrentWork } from "./current-work";

/**
 * MY WORK — the page body, composed against `03-my-work.jpeg`.
 *
 * The reference's structure is adopted wholesale and its unsupported CONTENT is
 * dropped, which is the distinction §0 draws. Reading down: a featured current
 * assignment, an all-work list, and a context column carrying a real breakdown
 * and the destinations either side of this one. The page header and the status
 * tabs are the route's, so that both render on the server and a tab change is a
 * navigation rather than a client filter.
 *
 * WHAT THE REFERENCE HAS THAT THIS DOES NOT, and why each is absent rather than
 * postponed: the documents/files panel (no storage foundation — D5), the quick
 * tools rail (upload photos, order materials, message the showroom, request a
 * date change: four features with no authority behind any of them), thumbnails
 * and client star ratings (no media, no reviews before Increment 12), the export
 * button, and "completed this month" (a defined metric nobody has defined).
 *
 * WHAT REPLACES THEM IS NOT FILLER. The context column keeps the reference's
 * summary — the same counts the tabs carry, as a breakdown with proportion bars
 * — and adds one navigation panel pointing at the two surfaces this one sits
 * between. Both are real; neither is analytics.
 *
 * THE HIERARCHY SURVIVES EMPTY DATA (§22). With no assignments at all the page
 * still renders its header, its tabs, its featured region (as a designed empty
 * state, not a hole) and its summary reading zero. What disappears is content,
 * never structure.
 */
export function MyWork({
  assignments,
  counts,
  locale,
  filtered,
}: {
  /** The rows for the CURRENT tab. */
  assignments: readonly MyAssignmentRow[];
  /** Counts across ALL of the caller's assignments — the tabs and the summary. */
  counts: Record<JobAssignmentStatus, number>;
  locale: Locale;
  /** True when a status tab is narrowing the list, which changes the empty copy. */
  filtered: boolean;
}) {
  const { t } = useI18n();
  const featured = featuredAssignment(assignments);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const currentCount = counts.scheduled + counts.in_progress;

  return (
    <WorkPane
      asideWidth="narrow"
      aside={
        <>
          {/*
            The reference's work-summary sidebar, with only figures that exist.
            `share` turns five counts into a readable breakdown rather than a
            list of numbers, and each row LINKS to its own tab — which is what
            makes this navigation rather than a dashboard.
          */}
          <Panel title={t("work.summary.title")} Icon={ClipboardIcon} tone="accent">
            <div className="flex flex-col">
              <PanelRow
                label={t("work.summary.current")}
                value={currentCount}
                locale={locale}
                tone="accent"
                href="/home/work?state=current"
                share={total ? currentCount / total : 0}
              />
              <PanelRow
                label={t("work.summary.scheduled")}
                value={counts.scheduled}
                locale={locale}
                tone="info"
                href="/home/work?state=scheduled"
                share={total ? counts.scheduled / total : 0}
              />
              <PanelRow
                label={t("work.summary.in_progress")}
                value={counts.in_progress}
                locale={locale}
                tone="accent"
                href="/home/work?state=in_progress"
                share={total ? counts.in_progress / total : 0}
              />
              <PanelRow
                label={t("work.summary.completed")}
                value={counts.completed}
                locale={locale}
                tone="success"
                href="/home/work?state=completed"
                share={total ? counts.completed / total : 0}
              />
              <PanelRow
                label={t("work.summary.cancelled")}
                value={counts.cancelled}
                locale={locale}
                tone="danger"
                href="/home/work?state=cancelled"
                share={total ? counts.cancelled / total : 0}
              />
            </div>
          </Panel>

          {/* Navigation, not analytics — the two surfaces either side of this
              one. It is here because the reference puts a rail here and because
              "where do I get more work" is a real question this page raises. */}
          <Panel title={t("work.quick.title")} Icon={BriefcaseIcon}>
            <ul className="flex flex-col gap-1.5">
              {[
                { href: "/home/jobs", label: t("work.quick.browse") },
                { href: "/home/jobs/applications", label: t("work.quick.applications") },
                { href: "/home/profile", label: t("work.quick.profile") },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-body text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      }
    >
      {/* ---- 1. The featured region. Always present, even when empty. ---- */}
      {featured ? (
        <CurrentWork assignment={featured} locale={locale} />
      ) : (
        <StatePanel
          icon={<BriefcaseIcon size={20} />}
          title={t("work.featured.noneTitle")}
          body={t("work.featured.noneBody")}
          action={
            <ButtonLink href="/home/jobs" variant="accent">
              {t("work.browse")}
            </ButtonLink>
          }
        />
      )}

      {/* ---- 2. All work ---- */}
      <section aria-labelledby="all-work">
        <h2 id="all-work" className="mb-sm text-body-lg font-medium text-fg">
          {t("work.list.title")}
        </h2>
        <WorkList assignments={assignments} locale={locale} filtered={filtered} />
      </section>
    </WorkPane>
  );
}

/**
 * The all-work list.
 *
 * `DataTable` is the canonical treatment and it already answers §9's responsive
 * requirement in the foundation rather than here: a real table at `tablet` and
 * above, and genuine cards below it built from the same columns, with
 * `secondary` columns dropped from the card so it stays scannable at 390px. No
 * squeezed table, and no second mobile implementation to keep in step.
 */
function WorkList({
  assignments,
  locale,
  filtered,
}: {
  assignments: readonly MyAssignmentRow[];
  locale: Locale;
  filtered: boolean;
}) {
  const { t } = useI18n();

  if (assignments.length === 0) {
    return (
      <StatePanel
        title={filtered ? t("work.empty.filtered") : t("work.empty.title")}
        body={filtered ? t("work.empty.filteredBody") : t("work.empty.body")}
        action={
          filtered ? (
            <ButtonLink href="/home/work" variant="outline">
              {t("work.tab.all")}
            </ButtonLink>
          ) : (
            <ButtonLink href="/home/jobs" variant="accent">
              {t("work.browse")}
            </ButtonLink>
          )
        }
      />
    );
  }

  return (
    <>
      <DataTable
        caption={t("work.list.showing")}
        rows={assignments}
        rowKey={(a) => a.id ?? ""}
        empty={null}
        columns={[
          {
            key: "job",
            header: t("work.list.job"),
            grow: true,
            /* The organization rides in the identity cell rather than in a
               column of its own. That is not a space-saving trick: the monogram
               beside it is ALREADY the organization, so a separate column was
               naming the same thing twice — and the width it cost is what forced
               the two status chips to wrap and pushed Agreed, Assigned and View
               into the table's horizontal scroller at the common 1440px desktop
               with the navigation expanded. One identity cell, one column fewer,
               and every column readable without scrolling to find it. */
            cell: (a) => (
              <RecordCell
                title={a.job_title ?? "—"}
                meta={[a.poster_org_name, a.trade_key ? tradeLabel(t, a.trade_key) : null]
                  .filter(Boolean)
                  .join(" · ")}
                href={`/home/work/${a.id}`}
                avatar={<Monogram name={a.poster_org_name ?? "—"} size={32} />}
              />
            ),
          },
          {
            key: "status",
            header: t("work.list.status"),
            /* ONE chip, like every row in the reference.
               The readiness marker used to ride beside it, which made this the
               widest column on the table and pushed Agreed, Assigned and View
               out of view. It is not lost: readiness only ever applies to an
               `in_progress` assignment, and that assignment is the one featured
               directly above this list with both markers on it — plus its own
               detail page, the poster's panel and /home. Repeating it in the
               HISTORY list cost the row its action and told the reader nothing
               the block above had not already said. */
            cell: (a) => (
              <span className="whitespace-nowrap">
                <AssignmentStatusBadge status={a.status ?? "scheduled"} />
              </span>
            ),
          },
          {
            key: "amount",
            header: t("work.list.amount"),
            numeric: true,
            cell: (a) => formatMoney(a.agreed_amount, locale),
          },
          {
            key: "date",
            header: t("work.list.date"),
            numeric: true,
            desktopOnly: true,
            secondary: true,
            cell: (a) => formatDate(a.created_at, locale),
          },
          {
            key: "view",
            header: "",
            cell: (a) => (
              <ButtonLink href={`/home/work/${a.id}`} variant="outline" size="sm">
                {t("work.list.view")}
              </ButtonLink>
            ),
          },
        ]}
      />
      <ListFooter>{t("work.list.showing")}</ListFooter>
    </>
  );
}