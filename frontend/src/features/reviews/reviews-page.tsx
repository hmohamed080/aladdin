import { Card, StatePanel } from "@/components/ui/primitives";
import { StarIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { Review } from "@/server/queries/reviews";
import { distributionRows, type RatingSummary } from "@/lib/reviews/summary";
import { DistributionRow, Stars } from "./parts";
import { ReviewCard } from "./review-card";
import { RatingFilter } from "./rating-filter";

/**
 * `/home/reviews`.
 *
 * COMPOSITION FROM `05-reviews.jpeg`: header and one-line explanation, then a
 * summary block carrying the average with stars, the total, and the 5→1
 * distribution as bars with percentages, then the list. That hierarchy is
 * adopted wholesale, because it is the right one — the number a professional is
 * judged by leads, the shape of it follows, and the evidence comes last.
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
 * So the page is one column rather than two. That is the deliberate difference:
 * the reference's second column is entirely things this product cannot say.
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
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-headline text-fg">{t("reviews.title")}</h1>
        <p className="max-w-prose text-body text-fg-secondary">{t("reviews.subtitle")}</p>
      </div>

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
        <>
          <RatingSummaryBlock summary={summary} t={t} />

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
            <ul className="flex flex-col gap-md">
              {reviews.map((review) => (
                <li key={review.id}>
                  <ReviewCard review={review} t={t} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The summary block: average, total, and the five-row distribution.
 *
 * Every number here comes from `summarizeReviews` over the same array the list
 * renders, so the block and the rows below it cannot disagree (§9).
 */
export function RatingSummaryBlock({
  summary,
  t,
}: {
  summary: RatingSummary;
  t: TranslateFn;
}) {
  const average = summary.average ?? 0;

  return (
    <Card className="flex flex-col gap-lg desktop:flex-row desktop:items-center desktop:gap-xl">
      <div className="flex shrink-0 flex-col items-center gap-2 desktop:w-56">
        <span className="text-display font-semibold tabular-nums text-fg">
          {average.toFixed(1)}
        </span>
        <Stars value={average} size={20} label={t("reviews.starsLabel", { n: average })} />
        <span className="text-label text-fg-secondary">
          {t("reviews.basedOn", { n: summary.total })}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2" data-testid="rating-distribution">
        {distributionRows(summary).map((row) => (
          <DistributionRow
            key={row.stars}
            stars={row.stars}
            count={row.count}
            percent={row.percent}
            label={t("reviews.starsRow", { n: row.stars })}
          />
        ))}
      </div>
    </Card>
  );
}
