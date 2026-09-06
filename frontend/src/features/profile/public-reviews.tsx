import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { Review } from "@/server/queries/reviews";
import { summarizeReviews } from "@/lib/reviews/summary";
import { Stars } from "@/features/reviews/parts";
import { ReviewCard } from "@/features/reviews/review-card";

/**
 * Reviews on a professional's public profile (§13).
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING. No empty section, no "no reviews yet",
 * no count of what is hidden — the same rule the portfolio section follows, and
 * for a sharper reason here: an empty Reviews heading on a public profile reads
 * as an absence of endorsement rather than an absence of data, which is a
 * judgement the product has no business rendering about somebody.
 *
 * The average is computed from the SAME array the cards below come from
 * (`summarizeReviews`), so a visitor can count the cards and get the number.
 * Suppressed reviews are already absent from the projection, so nothing here
 * filters and nothing can drift.
 *
 * The card is the exact component the professional sees on their own page. If
 * the two could differ, one of them would be a softened copy.
 */
export function PublicReviews({
  reviews,
  t,
  locale,
}: {
  reviews: Review[];
  t: TranslateFn;
  locale: Locale;
}) {
  if (reviews.length === 0) return null;

  const summary = summarizeReviews(reviews);
  const average = summary.average ?? 0;

  return (
    <section className="flex flex-col gap-md" aria-labelledby="public-reviews">
      <div className="flex flex-wrap items-baseline justify-between gap-md">
        <h2 id="public-reviews" className="text-title text-fg">
          {t("profile.publicPage.reviews")}
        </h2>
        <div className="flex items-center gap-2">
          <Stars value={average} label={t("reviews.starsLabel", { n: average })} />
          <span className="text-body-lg font-medium tabular-nums text-fg">
            {average.toFixed(1)}
          </span>
          <span className="text-label text-fg-secondary">
            {t("reviews.basedOn", { n: summary.total })}
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-md">
        {reviews.map((review) => (
          <li key={review.id}>
            <ReviewCard review={review} t={t} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
