/**
 * The ONE derivation of a rating summary (§9).
 *
 * Pure, and deliberately taking the SAME array the list renders rather than
 * running its own query. That is what makes "the summary and the list cannot
 * disagree" a property instead of a promise: there is no second query to drift,
 * no cache to go stale, and no window in which a suppressed review is counted in
 * one place and absent from the other. Both projections already exclude
 * suppressed reviews, so whatever reaches this function is exactly what a reader
 * can see.
 *
 * Every consumer uses it — the Reviews page, the profile hub and the public
 * profile — so a number shown in three places is computed once.
 */

export type RatingValue = 1 | 2 | 3 | 4 | 5;

/** The minimum a review must carry to be counted. */
export type RatedReview = { rating: number };

export type RatingSummary = {
  /**
   * The mean, rounded to one decimal — or NULL when there are no reviews.
   *
   * Null rather than 0, because 0 is a rating a person could conceivably have
   * been given and "no reviews yet" is not a bad score. §9 names this: a fresh
   * professional showing `0.0` beside four stars' worth of empty space would be
   * the product inventing a verdict nobody delivered.
   */
  average: number | null;
  total: number;
  /** Count per star, always all five keys, so a bar chart never has holes. */
  distribution: Record<RatingValue, number>;
};

const STARS: RatingValue[] = [5, 4, 3, 2, 1];

export function summarizeReviews(reviews: readonly RatedReview[]): RatingSummary {
  const distribution: Record<RatingValue, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  let sum = 0;
  let total = 0;
  for (const review of reviews) {
    // A rating outside 1–5 cannot exist — the table refuses it — so anything
    // else here means the row did not come from this domain. Skipping keeps a
    // corrupt row out of the average rather than letting it move a number a
    // person is judged by.
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) continue;
    distribution[review.rating as RatingValue] += 1;
    sum += review.rating;
    total += 1;
  }

  return {
    average: total === 0 ? null : Math.round((sum / total) * 10) / 10,
    total,
    distribution,
  };
}

/** The five rows of a distribution, highest first, as the reference shows them. */
export function distributionRows(
  summary: RatingSummary,
): { stars: RatingValue; count: number; percent: number }[] {
  return STARS.map((stars) => ({
    stars,
    count: summary.distribution[stars],
    // Zero reviews means zero percent, not a division by zero — and the bar is
    // then simply empty, which is the honest picture.
    percent: summary.total === 0 ? 0 : Math.round((summary.distribution[stars] / summary.total) * 100),
  }));
}

/**
 * How many of five stars to fill for a value.
 *
 * Rounds to the NEAREST HALF rather than to a whole star, because a 4.4 average
 * shown as four stars and a 4.6 shown as five would both be misreadings of the
 * same tenth of a point. The numeral is always displayed beside it, so the stars
 * are the impression and the number is the fact.
 */
export function starFill(value: number): number {
  return Math.round(value * 2) / 2;
}
