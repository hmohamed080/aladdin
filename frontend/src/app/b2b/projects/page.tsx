import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listProjects, type ProjectListRow } from "@/server/queries/execution";
import { PageHeader } from "@/features/sales/page-parts";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { ProjectTable } from "@/features/execution/execution-lists";
import { LayersIcon, ActivityIcon, CheckIcon, AlertIcon } from "@/components/ui/icons";

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

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        title={m.execution.project.title}
        subtitle={m.execution.project.subtitle}
        count={rows.length}
      />

      <StatTiles
        tiles={[
          { label: m.execution.project.stat.active, value: countBy(rows, "active"), Icon: ActivityIcon, tone: "accent" },
          { label: m.execution.project.stat.planned, value: countBy(rows, "planned"), Icon: LayersIcon, tone: "info" },
          { label: m.execution.project.stat.completed, value: countBy(rows, "completed"), Icon: CheckIcon, tone: "success" },
          { label: m.execution.project.stat.overdue, value: overdue(rows), Icon: AlertIcon, tone: "danger" },
        ]}
      />

      <div>
        {showIncoming ? (
          <TabLinks
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
        />
      </div>
    </div>
  );
}
