import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  getOrgJob,
  getActiveAssignment,
  listJobApplicants,
  isPosterVerified,
} from "@/server/queries/jobs";
import { listProgressUpdates } from "@/server/queries/job-assignments";
import { BackLink, FlashSuccess } from "@/features/sales/page-parts";
import { JobDetail } from "@/features/jobs/job-detail";

export const dynamic = "force-dynamic";

/**
 * The poster's view of one opening.
 *
 * `notFound()` when the job does not resolve, and that covers the cross-tenant
 * case without a tenancy check of its own: `jobs` RLS admits poster-org members,
 * the assigned installer and platform staff, so another organization's id in the
 * URL returns null here. THE URL IS NEVER THE AUTHORITY — the id is a lookup key
 * and the policy underneath still asks about `auth.uid()`.
 */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; awarded?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { jobId } = await params;
  const sp = await searchParams;

  const job = await getOrgJob(supabase, jobId);
  if (!job || job.poster_org_id !== org.organizationId) notFound();

  const canPost =
    org.capabilities.includes("job.post") || org.capabilities.includes("org.manage");
  const canManage =
    org.capabilities.includes("job.manage") || org.capabilities.includes("org.manage");

  const [assignment, orgVerified] = await Promise.all([
    getActiveAssignment(supabase, jobId),
    // Only a draft can be published, so only a draft needs the answer.
    job.status === "draft" && canPost
      ? isPosterVerified(supabase, org.organizationId)
      : Promise.resolve(false),
  ]);

  // The assignee's NAME comes from the applicants projection rather than a
  // second profile read: the poster cannot open an installer's profile row at
  // all, and `job_applicants` is the one authorized place their identity exists
  // on this side.
  let assignee: string | null = null;
  let progress: Awaited<ReturnType<typeof listProgressUpdates>> = [];
  if (assignment) {
    const [applicants, updates] = await Promise.all([
      listJobApplicants(supabase, jobId),
      // The SAME reader the installer's detail page uses.
      // `job_progress_select_parties` admits members of the posting
      // organization, so this side needs no projection of its own — and a second
      // poster-only copy would be a second thing to keep in step.
      listProgressUpdates(supabase, assignment.id),
    ]);
    assignee =
      applicants.find((a) => a.application_id === assignment.application_id)?.display_name ?? null;
    progress = updates;
  }

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/jobs">{m.jobs.title}</BackLink>
      {sp.created ? <FlashSuccess messageKey="jobs.flash.created" /> : null}
      {sp.saved ? <FlashSuccess messageKey="jobs.flash.updated" /> : null}
      {sp.awarded ? <FlashSuccess messageKey="jobs.flash.awarded" /> : null}
      <JobDetail
        job={job}
        assignee={assignee}
        assignment={assignment}
        progress={progress}
        role={{ canPost, canManage, orgVerified }}
        locale={locale}
      />
    </div>
  );
}
