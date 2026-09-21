import { InstallerWelcome } from "@/features/installer-dashboard-preview/installer-welcome";
import { ProfileCompletionBanner } from "@/features/installer-dashboard-preview/profile-completion-banner";
import { JobOpportunitiesSection } from "@/features/installer-dashboard-preview/job-opportunities-section";
import { NeedsAttentionSection } from "@/features/installer-dashboard-preview/needs-attention-section";
import { BrandEcosystemSection } from "@/features/installer-dashboard-preview/brand-ecosystem-section";
import { LearningSection } from "@/features/installer-dashboard-preview/learning-section";
import { RewardsCard } from "@/features/installer-dashboard-preview/rewards-card";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { PointsEntrySource } from "@/features/points/view-model";
import { toOpportunityVMs, toProfileCompletionVM, toRewardsVM, toWelcomeVM } from "./installer-dashboard-data";

type Props = {
  data: PersonalHomeData;
  opportunities: readonly OpportunityRow[];
  pointsBalance: number;
  recentPointsEntry: PointsEntrySource | null;
  reviewsAverage: number | null;
  reviewsTotal: number;
  completedJobsCount: number;
  locale: Locale;
  t: TranslateFn;
};

/**
 * The REAL side of the installer/technician dashboard — the same approved
 * presentation as `/preview/installer-dashboard`, filled with this caller's
 * own production data through the adapter in `./installer-dashboard-data.ts`.
 *
 * Every section below is the SAME component the preview renders (imported
 * from `features/installer-dashboard-preview/*`, never re-implemented here),
 * so the two routes cannot drift into two different dashboard designs again.
 * A module with no real backend source yet (needs-action, the brand
 * ecosystem, learning, rewards levels) renders that component's own approved
 * empty state rather than the preview's mock content — see
 * `installer-dashboard-data.ts`'s doc comment.
 */
export function InstallerHome({
  data,
  opportunities,
  pointsBalance,
  recentPointsEntry,
  reviewsAverage,
  reviewsTotal,
  completedJobsCount,
  locale,
  t,
}: Props) {
  const firstName = (data.displayName || t("personalHome.professional.friend")).split(" ")[0] ?? "";
  const opportunityVMs = toOpportunityVMs(opportunities, t, locale);

  return (
    <div className="flex flex-col gap-5" data-testid="installer-home">
      <InstallerWelcome
        data={toWelcomeVM(firstName, opportunityVMs.length, pointsBalance)}
        pointsHref="/home/points"
      />

      <ProfileCompletionBanner data={toProfileCompletionVM(data)} />

      <JobOpportunitiesSection
        opportunities={opportunityVMs}
        emptyTitle={t("jobs.opportunities.emptyTitle")}
        emptyBody={t("jobs.opportunities.emptyBody")}
        viewAllHref="/home/jobs"
        sortable={false}
      />

      <div className="grid items-stretch gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
        <NeedsAttentionSection items={[]} />
        <BrandEcosystemSection items={[]} />
        <LearningSection featured={null} items={[]} />
        <RewardsCard
          data={toRewardsVM({
            points: pointsBalance,
            recentEntry: recentPointsEntry,
            t,
            locale,
            rating: reviewsAverage,
            ratingCount: reviewsTotal,
            completedJobs: completedJobsCount,
          })}
          viewAllHref="/home/points"
        />
      </div>
    </div>
  );
}
