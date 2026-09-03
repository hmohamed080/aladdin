import { Card } from "@/components/ui/primitives";
import { Monogram } from "@/components/ui/data-table";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate } from "@/lib/ui/format";
import { tradeLabel } from "@/lib/i18n/trade-label";
import type { Review } from "@/server/queries/reviews";
import { Stars } from "./parts";

/**
 * One review, as both the professional and the public see it.
 *
 * THE SAME COMPONENT ON BOTH SURFACES, deliberately. A review a person reads
 * about themselves and the one a stranger reads must be identical — if they
 * could differ, the professional would be looking at a softened copy of the
 * thing they are actually being judged by. Both projections carry the same
 * columns, so there is nothing to differ over.
 *
 * THE REVIEWER IS THE ORGANIZATION. The reference pack shows an individual client
 * name, face and a "verified client" tick; none of that exists here, and the
 * absence is the product rule rather than a missing feature: the review is the
 * organization's statement, and naming the employee who typed it would put a
 * person on a surface the reviewed professional cannot reply to. `Monogram` is
 * the answer this codebase already gives to "there is no image pipeline".
 */
export function ReviewCard({
  review,
  t,
  locale,
}: {
  review: Review;
  t: TranslateFn;
  locale: Locale;
}) {
  const trade = review.tradeKey ? tradeLabel(t, review.tradeKey) : null;
  const context = [review.jobTitle, trade].filter(Boolean).join(" · ");

  return (
    <Card pad="sm" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={review.orgName} size={36} />
          <div className="min-w-0">
            {/* `<bdi>` RATHER THAN dir="auto" ON THE BLOCK, and the difference
                is visible at 390px in Arabic. `dir="auto"` sets the direction of
                the paragraph itself, so an English organisation name flips the
                whole block to LTR — and `text-align: start` then means LEFT,
                stranding the name at the far edge of the card while its monogram
                sits at the other. `<bdi>` isolates the RUN of text instead: the
                block keeps the page's direction (so it hugs the monogram), and
                the name still renders correctly left-to-right inside it. */}
            <p className="truncate text-body-lg font-medium text-fg">
              <bdi dir="auto">{review.orgName}</bdi>
            </p>
            {context ? (
              <p className="truncate text-label text-fg-secondary">
                <bdi dir="auto">{context}</bdi>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Stars
              value={review.rating}
              label={t("reviews.starsLabel", { n: review.rating })}
            />
            <span className="text-body-lg font-medium tabular-nums text-fg">
              {review.rating}
            </span>
          </div>
          <span className="text-label text-fg-muted">
            {formatDate(review.createdAt, locale)}
          </span>
        </div>
      </div>

      {review.comment ? (
        <p className="max-w-prose whitespace-pre-line text-body text-fg-secondary">
          <bdi dir="auto">{review.comment}</bdi>
        </p>
      ) : null}
    </Card>
  );
}
