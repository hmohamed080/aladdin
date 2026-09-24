import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { loadPlatformRole } from "@/server/queries/platform";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry, businessEntries } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getServerSupabase } from "@/lib/supabase/server";
import { NoPersonalWorkspace } from "@/features/home/no-personal-workspace";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ConsumerHome } from "@/features/home/consumer-home";
import { ProfessionalHome } from "@/features/home/professional-home";
import {
  listMyAssignments,
  featuredAssignment,
  countAssignmentsByStatus,
} from "@/server/queries/job-assignments";
import { listJobOpportunities } from "@/server/queries/job-opportunities";
import { getPointsBalance, listPointsEntries } from "@/server/queries/points";
import { loadMyReviewSummary } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import { loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { CompleteProfileCard } from "@/features/profile/complete-profile-card";

export const dynamic = "force-dynamic";

/**
 * How many real open opportunities the Home preview shows — a bounded read,
 * never the full board. Three, not four (Increment 14 composition
 * correction): the reference leads with a compact three-up row, and a fourth
 * card only forced an awkward half-row at the width the preview panel
 * actually gets beside the Quick Access rail.
 */
const HOME_OPPORTUNITIES_PREVIEW = 3;

/**
 * The ONE personal-account surface. A signed-in caller with no organization —
 * an End Consumer, or an individual professional (Engineer, Interior Designer,
 * Installer/Technician, Contractor, org-less Salesperson) — lands here, and the
 * page is persona-aware rather than consumer-specific.
 *
 * Three guards, all derived, never assumed:
 *   * an account that has not finished onboarding resumes at /onboarding;
 *   * platform staff belong in /admin;
 *   * a caller with NO personal persona has no personal home to show. A
 *     business-only identity is sent to its business workspace rather than a
 *     fabricated, empty Personal one; a caller with neither gets an account-safe
 *     terminal here (never a redirect, which would loop).
 *
 * Crucially, merely BELONGING to an organization no longer evicts the caller: an
 * Engineer who also owns a business keeps a real personal home, and the workspace
 * switcher — not a forced redirect — decides where they work.
 *
 * Reaching this page never depends on a verification decision — completing
 * onboarding activates the account, and trust state is shown, not enforced.
 *
 * SIX REAL READS, IN PARALLEL (Increment 14, plus the installer dashboard's
 * own recent-points-entry read). `loadMyTrades` dropped out of this page's
 * own `Promise.all` — the professional's practice detail moved to the
 * Account Overview, so Home no longer pays for a trades round trip it does
 * not render. What replaced it are the same functions `/home/points`,
 * `/home/reviews`, `/home/network` and `/home/jobs` already call, so the
 * summary strip and the opportunities preview cannot disagree with those
 * pages' own numbers.
 */
export default async function PersonalHomePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  if (await loadPlatformRole(supabase)) redirect("/admin");

  // Informational only (never a gate): the persistent "Complete your profile"
  // card. A failed read yields null and the card simply does not render.
  const completion = await loadMyProfileCompletion();
  const completionCard = completion ? <CompleteProfileCard completion={completion} /> : null;

  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) {
    if (businessEntries(entries).length > 0) redirect("/b2b");
    // Typically a business-track account that is access_ready but has not
    // created its organization yet — it gets NO membership or /b2b access from
    // that, only this terminal (whose CTA is "create your business") plus the
    // completion checklist.
    return (
      <div className="flex flex-col gap-lg">
        {completionCard}
        <NoPersonalWorkspace />
      </div>
    );
  }

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  // Only a professional has any of this to read — a consumer holds none of it
  // by construction, since every one of these descends from an assignment,
  // review or referral only a professional persona could have.
  if (data.variant !== "professional") {
    return (
      <div className="flex flex-col gap-lg">
        {completionCard}
        <ConsumerHome data={data} t={t} />
      </div>
    );
  }

  const [assignments, opportunities, pointsBalance, recentPointsEntries, reviews, network] = await Promise.all([
    listMyAssignments(supabase),
    listJobOpportunities(supabase, { limit: HOME_OPPORTUNITIES_PREVIEW }),
    getPointsBalance(supabase),
    listPointsEntries(supabase, { limit: 1 }),
    loadMyReviewSummary(),
    listMyNetworkOrganizations(supabase),
  ]);
  const completedJobsCount = countAssignmentsByStatus(assignments).completed;

  return (
    <div className="flex flex-col gap-lg">
      {completionCard}
      <ProfessionalHome
        data={data}
        currentWork={featuredAssignment(assignments)}
        opportunities={opportunities}
        pointsBalance={pointsBalance}
        recentPointsEntry={recentPointsEntries[0] ?? null}
        reviewsAverage={reviews.average}
        reviewsTotal={reviews.total}
        networkCount={network.length}
        completedJobsCount={completedJobsCount}
        locale={locale}
        t={t}
      />
    </div>
  );
}
