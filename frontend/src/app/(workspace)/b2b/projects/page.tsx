import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listProjects, type ProjectListRow } from "@/server/queries/execution";
import { PageHeader } from "@/components/ui/workspace-layout";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { ProjectTable } from "@/features/execution/execution-lists";
import { formatCompactMoney } from "@/lib/ui/format";
import { LayersIcon, ActivityIcon, CheckIcon, AlertIcon, MoneyIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

function countBy(rows: ProjectListRow[], status: string) {
  return rows.filter((p) => p.status === status).length;
}

/** Overdue = a target date in the past on a project that has not completed. */
function overdue(rows: ProjectListRow[]) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter((p) => p.target_date && p.target_date < today && p.status !== "completed").length;
}

/**
 * Projects — delivery work, with the side this business executes leading.
 * The counterparty tab appears only when the business actually has projects being
 * delivered FOR it, so a pure executor never sees an empty second tab.
 *
 * The tiles measure the tab you are looking at, not the union of both: a manager
 * asking "how much work do we have running" means the work on screen, and a
 * figure that silently included the other perspective would not reconcile with
 * the table under it.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const [executing, incoming] = await Promise.all([
    listProjects(supabase, org.organizationId, "executing"),
    listProjects(supabase, org.organizationId, "requester"),
  ]);

  const showIncoming = incoming.length > 0;
  const view = showIncoming && sp.view === "incoming" ? "incoming" : "executing";
  const rows = view === "executing" ? executing : incoming;

  // `projects.branch_id` is always the REQUESTER-side branch. On the incoming tab
  // that is this business's own branch and can be named from the workspace context
  // already resolved for the shell (no extra request); on the executing tab it
  // belongs to the client, whose branch names this caller cannot see — so the
  // column is simply not offered there.
  const branchNames =
    view === "incoming" ? Object.fromEntries(org.branches.map((b) => [b.id, b.name])) : undefined;
  const value = rows.reduce((s, p) => s + Number(p.order_total ?? 0), 0);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={LayersIcon}
        title={m.execution.project.title}
        subtitle={m.execution.project.subtitle}
        count={rows.length}
      />

      <StatTiles
        locale={locale}
        layout="strip"
        tiles={[
          { label: m.execution.project.stat.active, value: countBy(rows, "active"), Icon: ActivityIcon, tone: "accent" },
          { label: m.execution.project.stat.planned, value: countBy(rows, "planned"), Icon: LayersIcon, tone: "info" },
          { label: m.execution.project.stat.completed, value: countBy(rows, "completed"), Icon: CheckIcon, tone: "success" },
          { label: m.execution.project.stat.overdue, value: overdue(rows), Icon: AlertIcon, tone: "danger" },
          { label: m.reports.projectValue, value: formatCompactMoney(value, locale), Icon: MoneyIcon },
        ]}
        className="desktop:grid-cols-5"
      />

      <div>
        {showIncoming ? (
          <TabLinks
            locale={locale}
            basePath="/b2b/projects"
            param="view"
            current={view === "executing" ? "" : "incoming"}
            label={m.execution.project.title}
            tabs={[
              { value: "", label: m.execution.project.executingHeading, count: executing.length },
              { value: "incoming", label: m.execution.project.incomingHeading, count: incoming.length },
            ]}
          />
        ) : null}

        <ProjectTable
          projects={rows}
          perspective={view === "executing" ? "executing" : "requester"}
          locale={locale}
          m={m}
          branchNames={branchNames}
        />
      </div>
    </div>
  );
}
