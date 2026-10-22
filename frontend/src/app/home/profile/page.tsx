import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { loadProfilePublication } from "@/server/queries/professional-profile";
import { loadProfessionalAssetSummary } from "@/server/queries/portfolio";
import { loadMyReviewSummary } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import { countMyAssignments } from "@/server/queries/job-assignments";
import { getPointsBalance } from "@/server/queries/points";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ProfileHub } from "@/features/profile/profile-hub";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";

import { InstallerAccountHub } from "@/features/installer-account/installer-account-hub";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import { loadMyServiceAreas, loadMyAvailabilityWindows } from "@/server/queries/service-areas";
import { loadMyTrades } from "@/server/queries/trades";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { describeLocation } from "@/lib/location/describe-location";
import { derivePointsLevel } from "@/lib/network/points-level";
import { readEnvSupportContact } from "@/features/installer-account/support-contact";

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
  if (!hasAppAccess(state)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  if (data.variant !== "professional") return <NoProfessionalProfile />;

  const [publication, assets, reviews, network, assignmentCounts, pointsBalance] = await Promise.all([
    loadProfilePublication(),
    loadProfessionalAssetSummary(),
    loadMyReviewSummary(),
    listMyNetworkOrganizations(supabase),
    // The EXACT per-status count from the database (`my_work_counts`) — never derived from a capped row list.
    countMyAssignments(supabase),
    getPointsBalance(supabase),
  ]);
  const completedJobsCount = assignmentCounts.completed;

  if (data.accountType === "installer_technician") {
    const [identity, areas, windows, trades] = await Promise.all([loadMyIdentity(), loadMyServiceAreas(), loadMyAvailabilityWindows(), loadMyTrades()]);
    const ar = locale === "ar";
    const n = (v: number) => new Intl.NumberFormat(ar ? "ar-EG" : "en-EG").format(v);
    const today = new Date().toISOString().slice(0, 10);
    const available = windows.length === 0 ? null : windows.some((w) => w.from <= today && (w.to === null || w.to >= today));
    const level = derivePointsLevel(pointsBalance);
    const tradeNames = trades.keys.map((k) => tradeLabel(t, k));
    return (
      <InstallerAccountHub
        data={{
          name: identity?.displayName ?? "",
          profession: tradeNames.length ? tradeNames.slice(0, 2).join(" · ") : (ar ? "صنايعي" : "Installer"),
          location: describeLocation({ governorate: areas.primaryGovernorate, city: areas.primaryCities[0] ?? null, cityCustomName: null }, locale),
          available,
          portraitUrl: identity?.avatarUrl ?? null,
          coverUrl: identity?.coverUrl ?? null,
          publicProfileHref: publication.listed && publication.profileId ? `/p/${publication.profileId}` : "/home/profile/edit",
          stats: [
            { id: "points", value: n(pointsBalance), label: ar ? "نقطة" : "points" },
            { id: "jobs", value: n(completedJobsCount), label: ar ? "شغل مكتمل" : "completed jobs" },
            { id: "rating", value: reviews.average === null ? "—" : new Intl.NumberFormat(ar ? "ar-EG" : "en-EG", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(reviews.average), label: ar ? "متوسط التقييم" : "average rating" },
            { id: "reviews", value: n(reviews.total), label: ar ? "تقييم" : "reviews" },
          ],
          modules: [
            { id: "network", title: ar ? "معارفي من المعارض" : "My showroom network", description: ar ? "المعارض والشركات التي عملت معها أو دعوتها" : "Showrooms and businesses you worked with or invited", metric: n(network.length), metricLabel: ar ? "شركة في شبكتك" : "businesses in your network", image: "/assets/installer-account/showroom.png", href: "/home/network", tone: "info" },
            { id: "skills", title: ar ? "مهاراتي وشهاداتي" : "My skills & certificates", description: ar ? "مهنك وشهاداتك الموثقة" : "Your trades and certificates", metric: n(assets.certificateTotal), metricLabel: ar ? "شهادات" : "certificates", chips: tradeNames.slice(0, 4), image: "/assets/installer-account/certificates.png", href: "/home/profile/certificates", tone: "success" },
            { id: "settings", title: ar ? "الإعدادات" : "Settings", description: ar ? "إدارة حسابك وبياناتك الشخصية والخصوصية" : "Manage your account, personal data, and privacy", metric: "", metricLabel: "", image: "/assets/installer-account/settings.png", href: "/home/settings", tone: "neutral" },
            { id: "reviews", title: ar ? "تقييماتي" : "My reviews", description: ar ? "تقييمات العملاء لأعمالك وجودة خدماتك" : "Client feedback on your work and service quality", metric: reviews.average === null ? "—" : `${reviews.average} / 5`, metricLabel: ar ? `${n(reviews.total)} تقييمًا من العملاء` : `${reviews.total} client reviews`, stars: reviews.average ?? undefined, image: "/assets/installer-account/reviews.png", href: "/home/reviews", tone: "danger" },
            { id: "rewards", title: ar ? "نقاطي ومكافآتي" : "My points & rewards", description: ar ? "تابع نقاطك ومستواك" : "Track your points and level", metric: n(pointsBalance), metricLabel: level.remainingToNextLevel === null ? (ar ? "نقطة · أعلى مستوى" : "points · top level") : (ar ? `نقطة · باقي ${n(level.remainingToNextLevel)} للمستوى التالي` : `points · ${level.remainingToNextLevel} to the next level`), progress: level.progressPct, image: "/assets/installer-account/rewards.png", href: "/home/points", tone: "warning" },
          ],
          supportHref: readEnvSupportContact(),
        }}
      />
    );
  }

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
