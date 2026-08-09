import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getProject, getProjectDisplay } from "@/server/queries/execution";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { getMessages } from "@/lib/i18n/translate";
import { ProjectDetail } from "@/features/execution/project-detail";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { projectId } = await params;
  const sp = await searchParams;

  const [project, display] = await Promise.all([
    getProject(supabase, projectId),
    getProjectDisplay(supabase, projectId),
  ]);
  if (!project || !display) notFound();

  const isExecutor = org.organizationId === project.executing_org_id;
  const isRequester = org.organizationId === project.requester_org_id;
  const canProject = org.capabilities.includes("project.write") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/projects">{m.execution.project.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="execution.flash.projectCreated" /> : null}
      <ProjectDetail
        project={project}
        requesterName={display.requester_name ?? "—"}
        executingName={display.executing_name ?? "—"}
        role={{ isExecutor, isRequester, canProject }}
        locale={locale}
      />
    </div>
  );
}
