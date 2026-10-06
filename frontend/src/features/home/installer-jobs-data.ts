import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { formatRelativeTime } from "@/lib/ui/format";
import type { JobCardVM } from "@/features/installer-job-opportunities-preview/view-model";
import type { OpportunityRow } from "@/server/queries/job-opportunities";

/**
 * THE REAL SIDE OF THE JOB BOARD'S DATA-ADAPTER BOUNDARY.
 *
 * `open_job_opportunities` rows -> `JobCardVM`, the same shape the preview builds
 * from fixtures in `installer-job-opportunities-preview/preview-adapter.ts`, so both
 * feed one `InstallerJobOpportunitiesView`.
 *
 * Nothing is invented. A field the data cannot supply is `null` and the card draws
 * its honest state instead:
 *   - distance and skill-match: no geolocation or skills model exists;
 *   - image: no job carries media (no column, no bucket) — the card draws the
 *     generic illustration for `tradeKey`, never a stock photo that would read as
 *     this job's picture;
 *   - amount: kept null if missing ("Budget not specified"), never 0.
 *
 * Not `server-only`, like `installer-dashboard-data.ts`: it is a pure transform of
 * rows already fetched. The reads themselves stay in `server/queries/*`.
 */
export function toJobCardVM(job: OpportunityRow, t: TranslateFn, locale: Locale): JobCardVM | null {
  // Every view column is nullable to the type generator — a row without an id or a
  // title is skipped rather than drawn half blank.
  if (!job.id || !job.title) return null;
  const place = [job.city, job.governorate].filter(Boolean).join("، ");
  return {
    id: job.id,
    title: job.title,
    org: job.poster_org_name || null,
    place: place || null,
    tradeKey: job.trade_key,
    tradeLabel: job.trade_key ? tradeLabel(t, job.trade_key) : null,
    durationDays: job.expected_duration_days,
    amount: job.offered_amount,
    postedLabel: job.published_at ? t("jobs.opportunities.published", { when: formatRelativeTime(job.published_at, locale) }) : null,
    image: null,
    hasApplied: Boolean(job.has_applied),
    href: `/home/jobs/${job.id}`,
    distanceKm: null,
    matchPercent: null,
  };
}

export function toJobCardVMs(jobs: readonly OpportunityRow[], t: TranslateFn, locale: Locale): JobCardVM[] {
  return jobs.flatMap((job) => {
    const vm = toJobCardVM(job, t, locale);
    return vm ? [vm] : [];
  });
}

/**
 * The count sentence, worded for what the read can honestly claim.
 *
 * The board loads at most `limit` rows. A shorter result is the COMPLETE set for
 * the current filters, so its length is exact; a result that reached the cap may be
 * cut off, so no total is claimed — only that up to `limit` are shown.
 */
export function jobCountLabel(loaded: number, limit: number, locale: Locale): string {
  const fmt = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG");
  if (loaded >= limit) {
    return locale === "ar" ? `عرض حتى ${fmt.format(limit)} فرصة` : `Showing up to ${fmt.format(limit)} opportunities`;
  }
  if (locale === "ar") return loaded === 1 ? "فرصة واحدة متاحة" : `${fmt.format(loaded)} فرصة متاحة`;
  return loaded === 1 ? "1 opportunity available" : `${fmt.format(loaded)} opportunities available`;
}
