import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatNumber, formatRelativeTime } from "@/lib/ui/format";
import type { Bi } from "@/features/installer-dashboard-preview/localized";
import type {
  InstallerNeedsActionItemVM,
  InstallerOpportunityVM,
  InstallerProfileCompletionVM,
  InstallerRewardsVM,
  InstallerWelcomeVM,
} from "@/features/installer-dashboard-preview/view-model";
import { toPointsEntryView, type PointsEntrySource } from "@/features/points/view-model";
import { derivePointsLevel } from "@/lib/network/points-level";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { toMatchBreakdown, type MatchColumns } from "@/lib/installer/overall-match";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { ProfileCompletion } from "@/server/queries/profile-identity";
import { placeLabel } from "@/lib/installer/opportunity-location";

/**
 * THE REAL SIDE OF THE DATA-ADAPTER BOUNDARY.
 *
 * Mirrors `installer-dashboard-preview/mock-data.ts`'s `mock*` functions
 * one-for-one, so both feed the exact same view-model shape into the exact
 * same shared section components — see that file's own doc comment. Nothing
 * here reads a mock export, and nothing here invents a figure the read layer
 * did not return: a field the backend has no source for yet (rewards levels,
 * needs-action items, the brand ecosystem, learning content, opportunity
 * distance/skill-match) is either omitted or left `null`, which the shared
 * components render as an honest empty state rather than a fabricated one.
 *
 * NOT `server-only`, deliberately, exactly like `features/points/view-model.ts`
 * it builds on: this is a pure row-to-view-model transform, not I/O, so it can
 * be reached from either a Server Component (`features/home/installer-home.tsx`,
 * `app/home/layout.tsx`) or a unit test without tripping the server/client
 * boundary check. The actual Supabase reads it transforms stay behind
 * `server/queries/*`, which IS marked `server-only`.
 */

/** A single real, untranslated value wrapped for the shared `Bi`-shaped
 *  components — never a translation, just the one stored value shown
 *  regardless of locale (see the redesign task's own instruction on this). */
function real(value: string): Bi {
  return { ar: value, en: value };
}

/** Every view column is nullable to the type generator regardless of what the
 *  underlying function guarantees (the same caveat `server/queries/network.ts`
 *  documents) — a row missing its id or title is skipped rather than drawn
 *  half blank. */
/** A discovery row, optionally carrying the Overall Match columns and whether the caller saved it (the paged board's rows do). */
export type MatchedOpportunityRow = OpportunityRow & Partial<MatchColumns> & { is_saved?: boolean | null };

export function toOpportunityVM(
  job: MatchedOpportunityRow,
  t: TranslateFn,
  locale: Locale,
): InstallerOpportunityVM | null {
  if (!job.id || !job.title) return null;
  const place = placeLabel(locale, job.governorate, job.city);
  return {
    id: job.id,
    title: real(job.title),
    org: job.poster_org_name ? real(job.poster_org_name) : null,
    place: place ? real(place) : null,
    // There is no geolocation, so no distance — never fabricated. The match is the canonical Overall Match as the
    // database computed it for THIS caller (the same breakdown every surface shows); a row that did not carry one
    // simply shows no badge.
    distanceKm: null,
    matchPercent: job.overall_percent ?? null,
    match: job.overall_percent === undefined ? null : toMatchBreakdown(job as MatchColumns),
    isSaved: Boolean(job.is_saved),
    // A missing amount stays missing: the card says "budget not specified"
    // rather than printing a zero nobody offered.
    paymentEGP: job.offered_amount,
    durationDays: job.expected_duration_days,
    publishedAgo: job.published_at ? real(formatRelativeTime(job.published_at, locale)) : null,
    tradeLabel: job.trade_key ? real(tradeLabel(t, job.trade_key)) : null,
    // No job in the schema carries media (no column, no bucket), so no image is
    // ever supplied here — a stock picture beside a real job reads as that job's
    // photo. The card draws the generic illustration for `tradeKey` instead.
    image: null,
    tradeKey: job.trade_key,
    hasApplied: Boolean(job.has_applied),
    href: `/home/jobs/${job.id}`,
  };
}

export function toOpportunityVMs(
  jobs: readonly MatchedOpportunityRow[],
  t: TranslateFn,
  locale: Locale,
): InstallerOpportunityVM[] {
  return jobs.flatMap((job) => {
    const vm = toOpportunityVM(job, t, locale);
    return vm ? [vm] : [];
  });
}

/** What the data can truthfully say about the openings the caller could still go for. */
export type OpportunitySummary = {
  /** Open opportunities the caller has not applied to (an exact count). */
  availableCount: number;
  /**
   * Of those, how many are provably in the caller's city/governorate — or null
   * when that cannot be said (no usable installer location, or a list too long
   * to inspect in full). Null is "unknown", never "zero".
   */
  nearbyCount: number | null;
};

/**
 * The welcome sentence, chosen from real facts only:
 *   nearby > 0                    -> "N work opportunities near you"
 *   otherwise, available > 0      -> "N work opportunities available"
 *   nothing open to apply to      -> "No work opportunities available right now"
 * "Near you" is claimed only from a catalogue-resolved city/governorate match.
 * "New" is never claimed: no per-user record of what has been seen exists, and an
 * open job is not a new one.
 */
export function toWelcomeVM(
  firstName: string,
  summary: OpportunitySummary,
  points: number,
  t: TranslateFn,
  locale: Locale,
): InstallerWelcomeVM {
  const nearby = summary.nearbyCount ?? 0;
  let line: string;
  if (nearby > 0) {
    line =
      nearby === 1
        ? t("personalHome.installer.opportunitiesNearbyOne")
        : t("personalHome.installer.opportunitiesNearby", { count: formatNumber(nearby, locale) });
  } else if (summary.availableCount > 0) {
    // One opening gets its own sentence: "1 work opportunities" is not
    // grammatical in English, nor "١ فرص" in Arabic.
    line =
      summary.availableCount === 1
        ? t("personalHome.installer.opportunitiesAvailableOne")
        : t("personalHome.installer.opportunitiesAvailable", { count: formatNumber(summary.availableCount, locale) });
  } else {
    line = t("personalHome.installer.opportunitiesNone");
  }
  return { firstName, opportunitiesLine: line, points };
}

/**
 * `null` once the profile is complete — the same rule the banner already
 * enforces everywhere else. The percentage is the database's own
 * `my_profile_completion()` (the figure Settings and the Complete-profile card
 * show), passed in as `completion`; nothing here re-derives or adjusts it. A
 * failed read (`null`) renders no banner rather than a guessed figure. The hint
 * stays generic (never "add 3 photos" — that specific count is mock-only prose).
 */
export function toProfileCompletionVM(
  data: PersonalHomeData,
  completion: ProfileCompletion | null,
): InstallerProfileCompletionVM {
  if (!completion || completion.percent >= 100) return null;
  const verified = data.verification.state === "verified";
  return {
    percent: completion.percent,
    hint: {
      ar: "أكمل البيانات الناقصة في ملفك لزيادة ظهورك للمعارض.",
      en: "Complete the missing fields in your profile to improve your visibility to showrooms.",
    },
    verified,
    verifiedHint: verified
      ? { ar: "حساب موثّق", en: "Verified account" }
      : { ar: "التوثيق منفصل عن اكتمال الملف", en: "Verification is separate from profile completion" },
    href: "/home/profile/edit",
  };
}

/**
 * Assignments the caller can act on right now, and nothing else: no
 * notification counts, no invented urgency.
 *   - `scheduled`: the work is assigned and not started. Starting it is the
 *     installer's own action (`job_assignment_start`: only the assigned
 *     installer, only from `scheduled`, no date gate), so it is genuinely
 *     actionable. It links to the assignment, where `startWorkAction` lives.
 *
 * DELIBERATELY NOT LISTED: an `in_progress` assignment with no progress report.
 * A report can always be added, but nothing makes one DUE — there is no
 * "update every X days" rule and no deadline model — so listing it would be
 * noise presented as an alert. If that is wanted later it needs a real product
 * rule (days since the last update, an approaching `ends_by`, …), not an
 * inference from an empty history.
 *
 * Capped so the module stays a glance, not a queue.
 */
export function toNeedsActionItems(
  assignments: readonly MyAssignmentRow[],
  t: TranslateFn,
  limit = 3,
): InstallerNeedsActionItemVM[] {
  const items: InstallerNeedsActionItemVM[] = [];
  for (const a of assignments) {
    if (!a.id || !a.job_title) continue;
    if (a.status !== "scheduled") continue;
    items.push({
      id: a.id,
      icon: "work",
      title: real(a.job_title),
      subtitle: real(t("personalHome.installer.attention.scheduled")),
      meta: real(a.poster_org_name ?? ""),
      ctaLabel: real(t("personalHome.installer.attention.start")),
      href: `/home/work/${a.id}`,
    });
    if (items.length === limit) break;
  }
  return items;
}

export function toRewardsVM({
  points,
  recentEntry,
  t,
  locale,
  rating,
  ratingCount,
  completedJobs,
}: {
  points: number;
  recentEntry: PointsEntrySource | null;
  t: TranslateFn;
  locale: Locale;
  rating: number | null;
  ratingCount: number;
  completedJobs: number;
}): InstallerRewardsVM {
  const view = recentEntry ? toPointsEntryView(recentEntry, t, locale) : null;
  // The approved presentation-only band, re-derived from the real balance on
  // every render and stored nowhere (see `lib/network/points-level.ts`). Not the
  // preview's fictional Silver/Gold tiers.
  const info = derivePointsLevel(points);
  const nextAt = info.remainingToNextLevel === null ? null : Math.max(0, points) + info.remainingToNextLevel;
  return {
    points,
    level: {
      label: real(t("network.rail.levelValue", { n: info.level })),
      nextLabel: info.isMaxLevel ? null : real(t("network.rail.levelValue", { n: info.level + 1 })),
      nextAt,
      progressPct: info.progressPct,
    },
    recentActivity: view
      ? { title: view.title, body: view.body, dateLabel: view.dateLabel, deltaLabel: view.deltaLabel }
      : null,
    rating,
    ratingCount,
    completedJobs,
    showReputation: true,
  };
}
