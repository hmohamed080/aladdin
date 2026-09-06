import { Card, StatePanel } from "@/components/ui/primitives";
import { StarIcon } from "@/components/ui/icons";
import { HomeHeader } from "@/features/home/parts";
import { Panel, WorkPane } from "@/components/ui/workspace-layout";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { Review } from "@/server/queries/reviews";
import { formatNumber } from "@/lib/ui/format";
import { distributionRows, type RatingSummary } from "@/lib/reviews/summary";
import { DistributionRow, Stars } from "./parts";
import { ReviewRow } from "./review-card";
import { RatingFilter } from "./rating-filter";

/**
 * `/home/reviews`.
 *
 * COMPOSITION FROM `05-reviews.jpeg`, REVISITED (Increment 14 correction): the
 * reference is a two-column dashboard — a compact continuous list carrying the
 * real work, a supporting rail stating the average, the total and the 5→1
 * distribution beside it — not a full-width summary stacked on full-width
 * cards. `WorkPane` gives it that shape for free: the same primitive Jobs
 * Opportunities already uses for its results-plus-rail geometry, so the two
 * pages read as the same product rather than two different layout systems.
 * The list itself moved from "one bordered card per review with gaps between"
 * to ONE continuous divided surface (`ReviewRow`, no card frame of its own) —
 * the same treatment `PointsHistory` already gives the Points ledger — so five
 * reviews read as a dense record rather than five loosely related panels.
 *
 * WHAT THE REFERENCE HAS THAT THIS DOES NOT, and why each is absent rather than
 * postponed:
 *
 *   * A right rail of per-category scores — quality 96%, punctuality 94%,
 *     professionalism 93%, cleanliness 92%, value 90%. There is ONE rating in
 *     this product. Five more would be five numbers nobody ever entered, and a
 *     professional would be scored on axes no client was ever asked about.
 *   * A "recommended" badge on each row. No such flag exists, and deriving one
 *     from the rating would invent a threshold the reviewer never agreed to.
 *   * A satisfaction percentage, and positive/neutral/negative counts. Both
 *     bucket the same five ratings into a coarser taxonomy nobody chose; the
 *     distribution below says strictly more, exactly.
 *   * A rating-over-time chart and improvement tips. The first is a shape this
 *     increment has no volume to draw honestly; the second is advice the product
 *     has no basis to give.
 *   * An individual client name, face and "verified client" tick. The reviewer
 *     is the ORGANIZATION (§1), and the employee who typed it is never exposed.
 *   * Export, pagination and a per-row overflow menu. Nothing to export, nothing
 *     yet to paginate, and no action a professional can take on a review — it is
 *     immutable and there is no reply.
 *
 * The reference's second column is not adopted wholesale, though — most of
 * what it holds (per-category scores, a trend chart, tips) is exactly the
 * list above. What IS real from that column — the average, the total and the
 * distribution — is what the supporting rail below carries; nothing in it is
 * a number nobody entered.
 */
export function ReviewsPage({
  reviews,
  summary,
  filter,
  t,
  locale,
}: {
  /** Already filtered for display; the summary is always of the WHOLE set. */
  reviews: Review[];
  summary: RatingSummary;
  filter: number | null;
  t: TranslateFn;
  locale: Locale;
}) {
  return (
    <div className="flex flex-col gap-xl" data-testid="reviews-page">
      {/* The shared personal-surface header — same component Home, Jobs,
          Settings and the Account Overview all open with (cross-page
          consistency, revisit §6). */}
      <HomeHeader eyebrow={t("personalNav.reviews")} title={t("reviews.title")} lead={t("reviews.subtitle")} />

      {summary.total === 0 ? (
        /* ZERO IS NOT A RATING. A summary block reading 0.0 beside five empty
           stars would be the product delivering a verdict nobody gave, so the
           whole block is replaced rather than rendered empty — and the panel
           explains where reviews come from, which is the one useful thing to
           say to somebody who has none yet. */
        <StatePanel
          icon={<StarIcon size={22} />}
          title={t("reviews.empty.title")}
          body={t("reviews.empty.body")}
        />
      ) : (
        <WorkPane
          mobileOrder="aside-first"
          aside={<RatingSummaryBlock summary={summary} locale={locale} t={t} />}
        >
          <div className="flex flex-wrap items-center justify-between gap-md">
            <h2 className="text-title text-fg">{t("reviews.listTitle")}</h2>
            <RatingFilter summary={summary} active={filter} />
          </div>

          {reviews.length === 0 ? (
            /* A filter that matches nothing is not an empty account, and saying
               "no reviews yet" here would be false. */
            <Card pad="sm">
              <p className="text-body text-fg-secondary">{t("reviews.noneMatch")}</p>
            </Card>
          ) : (
            <ul className="divide-y rounded-md border bg-surface shadow-card">
              {reviews.map((review) => (
                <li key={review.id} className="p-md">
                  <ReviewRow review={review} t={t} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </WorkPane>
      )}
    </div>
  );
}

/**
 * The supporting rail: average, total, and the five-row distribution.
 *
 * Every number here comes from `summarizeReviews` over the same array the list
 * renders, so the rail and the rows beside it cannot disagree (§9). Stacked
 * top to bottom rather than side by side now that it lives in `WorkPane`'s
 * narrow column, not a full-width card of its own.
 */
export function RatingSummaryBlock({
  summary,
  locale,
  t,
}: {
  summary: RatingSummary;
  locale: Locale;
  t: TranslateFn;
}) {
  const average = summary.average ?? 0;

  return (
    <Panel title={t("reviews.summaryTitle")} Icon={StarIcon}>
      <div className="flex flex-col gap-lg">
        <div className="flex flex-col items-center gap-2">
          {/* `formatNumber`, not `.toFixed(1)` — the same Arabic-Indic-digit rule
              every other headline figure in the product follows (revisit §6). */}
          <span className="text-display font-semibold tabular-nums text-fg">
            {formatNumber(average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </span>
          <Stars value={average} size={20} label={t("reviews.starsLabel", { n: average })} />
          <span className="text-label text-fg-secondary">
            {t("reviews.basedOn", { n: summary.total })}
          </span>
        </div>

        <div className="flex flex-col gap-2" data-testid="rating-distribution">
          {distributionRows(summary).map((row) => (
            <DistributionRow
              key={row.stars}
              stars={row.stars}
              count={row.count}
              percent={row.percent}
              label={t("reviews.starsRow", { n: row.stars })}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}
