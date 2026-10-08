import { InstallerWelcome } from "@/features/installer-dashboard-preview/installer-welcome";
import { ProfileCompletionBanner } from "@/features/installer-dashboard-preview/profile-completion-banner";
import { NeedsAttentionSection } from "@/features/installer-dashboard-preview/needs-attention-section";
import { BrandEcosystemSection } from "@/features/installer-dashboard-preview/brand-ecosystem-section";
import { LearningSection } from "@/features/installer-dashboard-preview/learning-section";
import { RewardsCard } from "@/features/installer-dashboard-preview/rewards-card";
import { InstallerHomeOpportunities } from "./installer-home-opportunities";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { ProfileCompletion } from "@/server/queries/profile-identity";
import type { PointsEntrySource } from "@/features/points/view-model";
import {
  type MatchedOpportunityRow,
  type OpportunitySummary,
  toNeedsActionItems,
  toOpportunityVMs,
  toProfileCompletionVM,
  toRewardsVM,
  toWelcomeVM,
} from "./installer-dashboard-data";

type Props = {
  data: PersonalHomeData;
  /**
   * The strip for the default quick filter, already ordered by the database (Best match = trade + specialty). Each row
   * carries the caller's canonical Overall Match breakdown and whether they saved it. The other filters are loaded on
   * demand by `InstallerHomeOpportunities`.
   */
  opportunities: readonly MatchedOpportunityRow[];
  /** The headline facts about openings (exact available count; nearby count or null). */
  opportunitySummary: OpportunitySummary;
  /** The caller's own assignments, for the needs-action module. */
  assignments: readonly MyAssignmentRow[];
  /** `my_profile_completion()` — null when the read failed (no banner then). */
  completion: ProfileCompletion | null;
  pointsBalance: number;
  recentPointsEntry: PointsEntrySource | null;
  reviewsAverage: number | null;
  reviewsTotal: number;
  completedJobsCount: number;
  locale: Locale;
  t: TranslateFn;
};

/**
 * SECTION ORDER — the approved presentation's, top to bottom (`InstallerDashboardPreview`):
 *   1. profile-completion banner        2. welcome        3. Opportunities for you (with its quick filters)
 *   4. the lower module row: Points & rewards · Learning · Brand ecosystem · Needs attention
 * The order and the lower row's column proportions are the preview's own; a test pins both.
 *
 * The REAL side of the installer/technician dashboard — the same approved
 * presentation as `/preview/installer-dashboard`, filled with this caller's
 * own production data through the adapter in `./installer-dashboard-data.ts`.
 *
 * Every section below is the SAME component the preview renders (imported
 * from `features/installer-dashboard-preview/*`, never re-implemented here),
 * so the two routes cannot drift into two different dashboard designs again.
 * A module with no real backend source yet (the brand ecosystem, learning)
 * renders that component's own approved empty state rather than the preview's
 * mock content. Needs-action lists only assignments whose next step is the
 * caller's own, and the rewards level is the derived points band — see
 * `installer-dashboard-data.ts`.
 */
export function InstallerHome({
  data,
  opportunities,
  opportunitySummary,
  assignments,
  completion,
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
      <ProfileCompletionBanner data={toProfileCompletionVM(data, completion)} />

      <InstallerWelcome
        data={toWelcomeVM(firstName, opportunitySummary, pointsBalance, t, locale)}
        pointsHref="/home/points"
      />

      <InstallerHomeOpportunities
        initial={opportunityVMs}
        emptyTitle={t("jobs.opportunities.emptyTitle")}
        emptyBody={t("jobs.opportunities.emptyBody")}
        viewAllHref="/home/jobs"
      />

      <div
        data-lower-module-grid=""
        className="grid min-h-0 items-stretch gap-4 tablet:grid-cols-2 desktop:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.55fr)_minmax(0,0.95fr)] desktop:grid-rows-1"
      >
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
        <LearningSection featured={null} items={[]} />
        <BrandEcosystemSection items={[]} />
        <NeedsAttentionSection items={toNeedsActionItems(assignments, t)} actionBelow />
      </div>
    </div>
  );
}
