import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatRelativeTime } from "@/lib/ui/format";
import type { Bi } from "@/features/installer-dashboard-preview/mock-data";
import type {
  InstallerOpportunityVM,
  InstallerProfileCompletionVM,
  InstallerRewardsVM,
  InstallerWelcomeVM,
} from "@/features/installer-dashboard-preview/view-model";
import { toPointsEntryView, type PointsEntrySource } from "@/features/points/view-model";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import type { PersonalHomeData } from "@/server/queries/personal-home";

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

const JOB_IMAGES = [
  "/assets/installer-dashboard/jobs/spc-flooring.jpg",
  "/assets/installer-dashboard/jobs/ac-install.jpg",
  "/assets/installer-dashboard/jobs/marble-alt.jpg",
] as const;

/** Every view column is nullable to the type generator regardless of what the
 *  underlying function guarantees (the same caveat `server/queries/network.ts`
 *  documents) — a row missing its id or title is skipped rather than drawn
 *  half blank. */
export function toOpportunityVM(
  job: OpportunityRow,
  index: number,
  t: TranslateFn,
  locale: Locale,
): InstallerOpportunityVM | null {
  if (!job.id || !job.title) return null;
  const place = [job.city, job.governorate].filter(Boolean).join("، ");
  return {
    id: job.id,
    title: real(job.title),
    org: job.poster_org_name ? real(job.poster_org_name) : null,
    place: place ? real(place) : null,
    // No geolocation or skills-match model exists yet — never fabricated.
    distanceKm: null,
    matchPercent: null,
    paymentEGP: job.offered_amount ?? 0,
    durationDays: job.expected_duration_days,
    publishedAgo: job.published_at ? real(formatRelativeTime(job.published_at, locale)) : null,
    tradeLabel: job.trade_key ? real(tradeLabel(t, job.trade_key)) : null,
    image: JOB_IMAGES[index % JOB_IMAGES.length] ?? JOB_IMAGES[0],
    hasApplied: Boolean(job.has_applied),
    href: `/home/jobs/${job.id}`,
  };
}

export function toOpportunityVMs(
  jobs: readonly OpportunityRow[],
  t: TranslateFn,
  locale: Locale,
): InstallerOpportunityVM[] {
  return jobs.flatMap((job, index) => {
    const vm = toOpportunityVM(job, index, t, locale);
    return vm ? [vm] : [];
  });
}

export function toWelcomeVM(
  firstName: string,
  nearbyOpportunitiesCount: number,
  points: number,
): InstallerWelcomeVM {
  return { firstName, nearbyOpportunitiesCount, points };
}

/**
 * `null` once the profile is complete — the same rule the banner already
 * enforces everywhere else. The hint stays generic (never "add 3 photos" —
 * that specific count is mock-only prose) because the missing-items list
 * `data.completeness.missing` is a set of field keys, not user-facing copy
 * this layer has a caption for.
 */
export function toProfileCompletionVM(data: PersonalHomeData): InstallerProfileCompletionVM {
  if (data.completeness.percent >= 100) return null;
  const verified = data.verification.state === "verified";
  return {
    percent: data.completeness.percent,
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
  return {
    points,
    // No points-level/progression system exists in the backend — only a
    // running balance. Never invent a tier or a "points to next level" figure.
    level: null,
    recentActivity: view
      ? { title: view.title, body: view.body, dateLabel: view.dateLabel, deltaLabel: view.deltaLabel }
      : null,
    rating,
    ratingCount,
    completedJobs,
  };
}
