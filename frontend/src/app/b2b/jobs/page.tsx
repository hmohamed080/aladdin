import { getPageContext } from "@/server/queries/page-context";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import { listOrgJobs, countByStatus, JOB_STATUSES, type JobStatus } from "@/server/queries/jobs";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { PageHeader, WorkPane } from "@/components/ui/workspace-layout";
import { StatTiles, TabLinks } from "@/components/ui/stat-tiles";
import { StatePanel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { DataTable, RecordCell, type Column } from "@/components/ui/data-table";
import { JobStatusBadge } from "@/features/jobs/badges";
import { formatDate, formatMoney } from "@/lib/ui/format";
import { BriefcaseIcon, UsersIcon, CheckIcon, FileTextIcon } from "@/components/ui/icons";
import type { JobListRow } from "@/server/queries/jobs";

export const dynamic = "force-dynamic";

/**
 * The organization's job management list.
 *
 * ONE QUESTION: what have we posted, and where has each one got to. Everything
 * on the page answers it — the tiles count real states, the table shows real
 * rows, and the filter is the canonical lifecycle and nothing else.
 *
 * WHAT IS DELIBERATELY ABSENT. The Installer reference set shows matched-candidate
 * counts, suitability percentages and urgency flags. No matching model exists in
 * this repository — Increment 6 built no scoring, no ranking and no
 * recommendation, and O5 forbids trade from becoming a gate — so inventing any of
 * those numbers here would put a figure in front of a poster that nothing
 * computed. The one count on this page, `applicationCount`, is a real `count(*)`
 * the poster is authorized to read.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const sp = await searchParams;

  const canPost = org.capabilities.includes("job.post") || org.capabilities.includes("org.manage");
  const canManage =
    org.capabilities.includes("job.manage") || org.capabilities.includes("org.manage");

  // The layout gate already keeps a member with neither capability off this
  // route, but a page must guard too — the same rule the other modules follow.
  if (!canPost && !canManage) {
    return (
      <div className="pb-16 tablet:pb-0">
        <PageHeader locale={locale} Icon={BriefcaseIcon} title={m.jobs.title} />
        <StatePanel tone="warning" title={m.jobs.denied.title} body={m.jobs.denied.body} />
      </div>
    );
  }

  // A filter may only name a state the lifecycle actually has.
  const filter = JOB_STATUSES.includes(sp.status as JobStatus)
    ? (sp.status as JobStatus)
    : undefined;

  // Unfiltered, so the tiles describe the whole module rather than the current
  // view — a "Drafts: 0" tile that only means "none in this filter" is a lie.
  const all = await listOrgJobs(supabase, org.organizationId);
  const counts = countByStatus(all);
  const rows = filter ? all.filter((j) => j.status === filter) : all;

  const columns: Column<JobListRow>[] = [
    {
      key: "title",
      header: m.jobs.field.title,
      cell: (j) => (
        <RecordCell
          title={j.title}
          href={`/b2b/jobs/${j.id}`}
          meta={j.tradeKey ? tradeLabel(t, j.tradeKey) : undefined}
        />
      ),
    },
    { key: "status", header: m.jobs.field.status, cell: (j) => <JobStatusBadge status={j.status} /> },
    {
      key: "location",
      header: m.jobs.field.location,
      desktopOnly: true,
      cell: (j) => [j.city, j.governorate].filter(Boolean).join(", ") || "—",
    },
    {
      key: "offer",
      header: m.jobs.field.offer,
      numeric: true,
      cell: (j) => formatMoney(j.offered_amount, locale),
    },
    {
      key: "applications",
      header: m.jobs.field.applications,
      numeric: true,
      cell: (j) => j.applicationCount,
    },
    {
      key: "date",
      header: m.jobs.field.published,
      numeric: true,
      desktopOnly: true,
      // A draft has no publication date, and showing its creation date under a
      // "Published" heading would be a small, constant lie.
      cell: (j) => (j.published_at ? formatDate(j.published_at, locale) : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={BriefcaseIcon}
        title={m.jobs.title}
        subtitle={m.jobs.subtitle}
        count={all.length}
        toolbar={
          canPost ? (
            <ButtonLink href="/b2b/jobs/new" variant="accent" size="sm">
              {m.jobs.new}
            </ButtonLink>
          ) : undefined
        }
      />

      <StatTiles
        locale={locale}
        layout="strip"
        tiles={[
          { label: m.jobs.stat.drafts, value: counts.draft, Icon: FileTextIcon },
          { label: m.jobs.stat.open, value: counts.open, Icon: BriefcaseIcon, tone: "accent" },
          { label: m.jobs.stat.awarded, value: counts.awarded, Icon: CheckIcon, tone: "success" },
          {
            label: m.jobs.stat.applications,
            value: all.reduce((n, j) => n + j.applicationCount, 0),
            Icon: UsersIcon,
          },
        ]}
      />

      <WorkPane>
        <TabLinks
          locale={locale}
          basePath="/b2b/jobs"
          param="status"
          current={filter ?? ""}
          label={m.jobs.filter.label}
          tabs={[
            { value: "", label: m.jobs.filter.all, count: all.length },
            ...JOB_STATUSES.map((s) => ({
              value: s,
              label: m.jobs.status[s],
              count: counts[s],
            })),
          ]}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(j) => j.id}
          caption={m.jobs.listCaption}
          empty={
            <StatePanel
              title={filter ? m.jobs.empty.filteredTitle : m.jobs.empty.title}
              body={filter ? m.jobs.empty.filteredBody : m.jobs.empty.body}
            />
          }
        />
      </WorkPane>
    </div>
  );
}
