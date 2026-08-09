import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listProjects } from "@/server/queries/execution";
import { PageHeader } from "@/features/sales/page-parts";
import { SectionTitle } from "@/components/ui/primitives";
import { ProjectList } from "@/features/execution/execution-lists";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [executing, incoming] = await Promise.all([
    listProjects(supabase, org.organizationId, "executing"),
    listProjects(supabase, org.organizationId, "requester"),
  ]);

  return (
    <div className="flex flex-col gap-xl pb-16 tablet:pb-0">
      <div>
        <PageHeader title={m.execution.project.title} subtitle={m.execution.project.subtitle} />
      </div>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.execution.project.executingHeading}</SectionTitle>
        <ProjectList projects={executing} perspective="executing" locale={locale} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{m.execution.project.incomingHeading}</SectionTitle>
        <ProjectList projects={incoming} perspective="requester" locale={locale} />
      </section>
    </div>
  );
}
