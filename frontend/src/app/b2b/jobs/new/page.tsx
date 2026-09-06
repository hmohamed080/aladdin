import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { loadTradeCatalog } from "@/server/queries/trades";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { BackLink } from "@/features/sales/page-parts";
import { JobForm } from "@/features/jobs/job-form";

export const dynamic = "force-dynamic";

/**
 * Post a job — which creates a DRAFT and nothing else.
 *
 * Publishing is a separate, deliberate act on the detail page, because it is the
 * irreversible half: the opening becomes visible to professionals, and the trade
 * and the amount freeze the moment the first application lands. Folding it into
 * "save" would make both of those a side effect of filling in a form.
 */
export default async function NewJobPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { org, locale } = ctx;
  const m = getMessages(locale);

  // `job.manage` decides applications; it does not author openings. A caller
  // holding only that reaches this route from the nav and is told which of the
  // two authorities they are missing, rather than being shown a form that
  // `job_create` will refuse.
  const canPost = org.capabilities.includes("job.post") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/jobs">{m.jobs.title}</BackLink>
      <PageHeader locale={locale} title={m.jobs.newTitle} subtitle={m.jobs.newSubtitle} />
      {canPost ? (
        <JobForm
          mode="create"
          orgId={org.organizationId}
          branchId={org.activeBranchId}
          trades={await loadTradeCatalog()}
        />
      ) : (
        <StatePanel tone="warning" title={m.jobs.postDenied.title} body={m.jobs.postDenied.body} />
      )}
    </div>
  );
}
