import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { StatePanel } from "@/components/ui/primitives";
import { BackLink } from "@/features/sales/page-parts";
import {
  OpportunityDetail,
  type OpportunityView,
  type MyCandidacy,
} from "@/features/jobs/opportunity-detail";
import {
  getJobOpportunity,
  getMyApplicationForJob,
} from "@/server/queries/job-opportunities";
import { assignmentIdsByApplication } from "@/server/queries/job-assignments";

export const dynamic = "force-dynamic";

/**
 * One opening, as the professional deciding about it sees it.
 *
 * TWO SOURCES, ONE PAGE, and which one answers is itself the state:
 *
 *   * `open_job_opportunities` — the job is live and its poster is verified, so
 *     the full opening is readable by anybody. This is the decision surface.
 *   * `my_job_applications` — the job has left discovery (awarded elsewhere,
 *     closed, cancelled, or its poster's verification lapsed) but this caller
 *     applied to it. Their own record still holds the whole job, so the page
 *     renders from that and says the opening is closed.
 *
 * A caller who never applied to a job that has left discovery gets an ordinary
 * not-found, which is the honest answer: to them it does not exist.
 *
 * NO USER ID IS PASSED ANYWHERE. Both seams resolve the caller from `auth.uid()`
 * inside their definers, so the jobId in the URL is a lookup key and never an
 * authority claim.
 */
export default async function JobOpportunityPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { jobId } = await params;

  const [opportunity, application] = await Promise.all([
    getJobOpportunity(supabase, jobId),
    getMyApplicationForJob(supabase, jobId),
  ]);

  if (!opportunity && !application) {
    return (
      <div className="flex flex-col gap-lg">
        <BackLink href="/home/jobs">{m.jobs.opportunities.title}</BackLink>
        <StatePanel title={m.jobs.detail.notFound} body={m.jobs.detail.notFoundBody} />
      </div>
    );
  }

  const job: OpportunityView = opportunity
    ? {
        jobId: opportunity.id!,
        title: opportunity.title ?? "",
        description: opportunity.description,
        tradeKey: opportunity.trade_key,
        posterOrgName: opportunity.poster_org_name,
        governorate: opportunity.governorate,
        city: opportunity.city,
        offeredAmount: opportunity.offered_amount,
        expectedDurationDays: opportunity.expected_duration_days,
        startsOn: opportunity.starts_on,
        endsBy: opportunity.ends_by,
        publishedAt: opportunity.published_at,
        discoverable: true,
        // Live and discoverable means open, by the seam's own definition.
        jobStatus: "open",
      }
    : {
        jobId: application!.job_id!,
        title: application!.job_title ?? "",
        description: application!.job_description,
        tradeKey: application!.trade_key,
        posterOrgName: application!.poster_org_name,
        governorate: application!.governorate,
        city: application!.city,
        offeredAmount: application!.offered_amount,
        expectedDurationDays: application!.expected_duration_days,
        startsOn: application!.starts_on,
        endsBy: application!.ends_by,
        publishedAt: application!.published_at,
        discoverable: false,
        jobStatus: application!.job_status,
      };

  const candidacy: MyCandidacy | null = application
    ? {
        applicationId: application.id!,
        status: application.status ?? "submitted",
        note: application.note,
        appliedAt: application.created_at,
        decidedAt: application.decided_at,
        decisionReason: application.decision_reason,
      }
    : null;

  /* §20. Only an ACCEPTED candidacy can have an assignment, so this is the one
     state that pays for the extra read — and the id comes from
     `job_assignments.application_id` rather than from anything on this page. */
  const assignmentId =
    candidacy?.status === "accepted"
      ? ((await assignmentIdsByApplication(supabase, [candidacy.applicationId])).get(
          candidacy.applicationId,
        ) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <BackLink href="/home/jobs">{m.jobs.opportunities.title}</BackLink>
      <OpportunityDetail
        job={job}
        application={candidacy}
        canApply={home.variant === "professional"}
        assignmentId={assignmentId}
        locale={locale}
      />
    </div>
  );
}
