import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
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
import { getPointsBalance } from "@/server/queries/points";
import { loadMyReviewSummary } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";

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
 * FIVE REAL READS, IN PARALLEL (Increment 14). `loadMyTrades` dropped out of
 * this page's own `Promise.all` — the professional's practice detail moved to
 * the Account Overview, so Home no longer pays for a trades round trip it does
 * not render. What replaced it are the same functions `/home/points`,
 * `/home/reviews`, `/home/network` and `/home/jobs` already call, so the
 * summary strip and the opportunities preview cannot disagree with those
 * pages' own numbers.
 */
export default async function PersonalHomePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  if (await loadPlatformRole(supabase)) redirect("/admin");

  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) {
    if (businessEntries(entries).length > 0) redirect("/b2b");
    return <NoPersonalWorkspace />;
  }

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  // Only a professional has any of this to read — a consumer holds none of it
  // by construction, since every one of these descends from an assignment,
  // review or referral only a professional persona could have.
  if (data.variant !== "professional") return <ConsumerHome data={data} t={t} />;

  const [assignments, opportunities, pointsBalance, reviews, network] = await Promise.all([
    listMyAssignments(supabase),
    listJobOpportunities(supabase, { limit: HOME_OPPORTUNITIES_PREVIEW }),
    getPointsBalance(supabase),
    loadMyReviewSummary(),
    listMyNetworkOrganizations(supabase),
  ]);
  const completedJobsCount = countAssignmentsByStatus(assignments).completed;

  return (
    <ProfessionalHome
      data={data}
      currentWork={featuredAssignment(assignments)}
      opportunities={opportunities}
      pointsBalance={pointsBalance}
      reviewsAverage={reviews.average}
      reviewsTotal={reviews.total}
      networkCount={network.length}
      completedJobsCount={completedJobsCount}
      locale={locale}
      t={t}
    />
  );
}
