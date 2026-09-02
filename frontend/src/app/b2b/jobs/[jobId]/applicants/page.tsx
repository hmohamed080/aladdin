import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getOrgJob, listJobApplicants } from "@/server/queries/jobs";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { ApplicantsList } from "@/features/jobs/applicants-list";
import { UsersIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Who applied, and the one decision the poster makes.
 *
 * Readable by any member of the posting organization — the same predicate
 * `job_applications` RLS uses, and the reason the nav gate is the union of the
 * two capabilities. DECIDING is narrower: only `job.manage` (or `org.manage`)
 * puts Award and Decline on screen, and the RPCs refuse anyone else regardless.
 *
 * The empty state is the expected one right now. Increment 8 has not shipped, so
 * no installer can apply through the product yet; a real local job legitimately
 * has zero applicants and the page says so rather than being padded with invented
 * people to look busy.
 */
export default async function JobApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ rejected?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { jobId } = await params;
  const sp = await searchParams;

  const job = await getOrgJob(supabase, jobId);
  if (!job || job.poster_org_id !== org.organizationId) notFound();

  const canManage =
    org.capabilities.includes("job.manage") || org.capabilities.includes("org.manage");

  // A draft cannot have applicants by construction, so the page explains the
  // next step instead of showing an empty list that looks like a failure.
  if (job.status === "draft") {
    return (
      <div className="pb-16 tablet:pb-0">
        <BackLink href={`/b2b/jobs/${job.id}`}>{job.title}</BackLink>
        <PageHeader locale={locale} Icon={UsersIcon} title={m.jobs.applicants.title} />
        <StatePanel
          title={m.jobs.applicants.notPublishedTitle}
          body={m.jobs.applicants.notPublishedBody}
        />
      </div>
    );
  }

  const applicants = await listJobApplicants(supabase, jobId);

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href={`/b2b/jobs/${job.id}`}>{job.title}</BackLink>
      {sp.rejected ? <FlashSuccess messageKey="jobs.flash.rejected" /> : null}
      <PageHeader
        locale={locale}
        Icon={UsersIcon}
        title={m.jobs.applicants.title}
        subtitle={m.jobs.applicants.subtitle}
        count={applicants.length}
      />
      <ApplicantsList
        jobId={job.id}
        applicants={applicants}
        canManage={canManage}
        jobIsOpen={job.status === "open"}
        locale={locale}
      />
    </div>
  );
}
