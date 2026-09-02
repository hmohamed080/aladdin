import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { BackLink } from "@/features/sales/page-parts";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { AssignmentDetail } from "@/features/work/assignment-detail";
import { getMyAssignment, listProgressUpdates } from "@/server/queries/job-assignments";

export const dynamic = "force-dynamic";

/**
 * One assignment, as its assigned professional sees it.
 *
 * `notFound()` covers three situations that are ONE situation to this route: the
 * assignment does not exist, it belongs to somebody else, or the caller is not
 * signed in as the person who holds it. `my_job_assignments` resolves the caller
 * from `auth.uid()` inside its definer and takes no user parameter, so another
 * professional's id in the URL simply returns nothing. THE URL IS NEVER THE
 * AUTHORITY.
 *
 * There is no discovery fallback of the kind `/home/jobs/[jobId]` needs. An
 * assignment does not depend on its job still being open, its poster still being
 * verified or its trade still being active — the projection joins all three
 * without filtering on any of them — so a completed or cancelled engagement
 * resolves here exactly as a live one does.
 */
export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const registration = await getRegistrationState();
  if (registration === "unverified") redirect("/auth/sign-in");
  if (registration !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const { assignmentId } = await params;
  const assignment = await getMyAssignment(supabase, assignmentId);
  if (!assignment) notFound();

  // Bilateral by policy and read straight from the base table — the same call
  // the poster's surface makes, because `job_progress_select_parties` admits
  // both of them.
  const updates = await listProgressUpdates(supabase, assignmentId);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" data-testid="assignment-detail">
      <BackLink href="/home/work">{m.work.back}</BackLink>
      <AssignmentDetail assignment={assignment} updates={updates} locale={locale} />
    </div>
  );
}
