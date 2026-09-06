import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { loadProfilePublication } from "@/server/queries/professional-profile";
import { loadProfessionalAssetSummary } from "@/server/queries/portfolio";
import { loadMyReviewSummary } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import { listMyAssignments, countAssignmentsByStatus } from "@/server/queries/job-assignments";
import { getPointsBalance } from "@/server/queries/points";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ProfileHub } from "@/features/profile/profile-hub";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";

export const dynamic = "force-dynamic";

/**
 * The Account Overview — "my account" in the reference pack's sense: one
 * place that holds the professional identity, a real summary of their
 * standing, what the public can see, and leads to every real account
 * surface (Portfolio, Certificates, Reviews, Points, Network, Work,
 * Settings).
 *
 * IT IS NOT A SECOND `/home`. The dashboard greets, says what to do right
 * now, and shows a preview of open work. This page answers a different
 * question — *what does my account actually say, in full* — which is why
 * publication state and the complete module grid live here and only a
 * compact snapshot strip lives on the dashboard.
 *
 * SIX REAL READS, IN PARALLEL. Points balance and completed-assignment
 * count are new to this page (Increment 14) — the same `getPointsBalance`
 * and `countAssignmentsByStatus` `/home/points` and `/home/work` themselves
 * call, so the summary strip here cannot disagree with those pages' own
 * numbers. `loadMyTrades` dropped out in the composition pass that followed:
 * the canonical trade is now shown (and edited) only on `/home/profile/edit`,
 * so this page no longer pays for a read it does not render.
 *
 * A CONSUMER HAS NO PROFESSIONAL PROFILE, and is told so rather than redirected:
 * there is nothing wrong with the account, the page simply belongs to a different
 * kind of one. Same reasoning as `ShowroomNotAvailable`.
 */
export default async function ProfileHubPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  if (data.variant !== "professional") return <NoProfessionalProfile />;

  const [publication, assets, reviews, network, assignments, pointsBalance] = await Promise.all([
    loadProfilePublication(),
    loadProfessionalAssetSummary(),
    loadMyReviewSummary(),
    listMyNetworkOrganizations(supabase),
    listMyAssignments(supabase),
    getPointsBalance(supabase),
  ]);
  const completedJobsCount = countAssignmentsByStatus(assignments).completed;

  return (
    <ProfileHub
      data={data}
      publication={publication}
      assets={assets}
      reviews={reviews}
      network={network}
      pointsBalance={pointsBalance}
      completedJobsCount={completedJobsCount}
      locale={locale}
      t={t}
    />
  );
}
