import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getOrgJob } from "@/server/queries/jobs";
import { loadTradeCatalog } from "@/server/queries/trades";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { BackLink } from "@/features/sales/page-parts";
import { JobForm } from "@/features/jobs/job-form";

export const dynamic = "force-dynamic";

/**
 * Edit an opening, while the lifecycle still allows it.
 *
 * `draft` and `open` only. Past that the contract is settled — someone may hold
 * an assignment against it — and `job_update` refuses. The page says so rather
 * than rendering a form whose Save button is guaranteed to fail: a read-only
 * notice is a smaller disappointment than a filled-in form that is rejected.
 */
export default async function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { jobId } = await params;

  const job = await getOrgJob(supabase, jobId);
  if (!job || job.poster_org_id !== org.organizationId) notFound();

  const canPost = org.capabilities.includes("job.post") || org.capabilities.includes("org.manage");
  const editable = job.status === "draft" || job.status === "open";

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href={`/b2b/jobs/${job.id}`}>{job.title}</BackLink>
      <PageHeader locale={locale} title={m.jobs.editTitle} subtitle={m.jobs.editSubtitle} />
      {!canPost ? (
        <StatePanel tone="warning" title={m.jobs.postDenied.title} body={m.jobs.postDenied.body} />
      ) : !editable ? (
        <StatePanel title={m.jobs.status[job.status]} body={m.jobs.awarded.readOnly} />
      ) : (
        <JobForm
          mode="edit"
          orgId={org.organizationId}
          job={job}
          /* What freezes the trade and the offer on screen (O7). The server
             enforces it regardless, through `job_update` and the immutability
             trigger beneath it — this only stops the form inviting a change
             that would be refused. */
          applicationCount={job.applicationCount}
          trades={await loadTradeCatalog()}
        />
      )}
    </div>
  );
}
