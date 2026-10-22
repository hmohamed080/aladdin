"use client";

import { Button } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { useCursorPages } from "@/features/home/use-cursor-pages";
import { loadMoreReviewsAction } from "@/server/actions/review-list";
import type { Review } from "@/server/queries/reviews";
import { ReviewRow } from "./review-card";

/**
 * The installer's reviews, appended page by page by CURSOR ("Show more").
 *
 * The server renders the FIRST page and the cursor of the one after it; every later page is fetched with the
 * cursor the previous page returned (`loadMoreReviewsAction`, which re-validates it and the rating filter).
 * The cursor chain, de-duplication, "a new filter discards appended pages" and retry-after-failure rules are
 * the shared `useCursorPages` ones — the same behaviour as Jobs and My Work. There is no ceiling: more exist
 * exactly while the last page shown returned a cursor.
 */
export function ReviewsList({
  reviews,
  nextCursor,
  rating,
}: {
  /** The first page, already filtered in SQL when `rating` is set. */
  reviews: readonly Review[];
  nextCursor: string | null;
  rating: number | null;
}) {
  const { t, locale } = useI18n();
  const pages = useCursorPages<Review>({
    resetKey: `${rating ?? "all"}|${reviews.map((r) => r.id).join(",")}`,
    first: reviews,
    firstNext: nextCursor,
    firstTotal: reviews.length,
    fetchPage: async (cursor) => {
      const result = await loadMoreReviewsAction(rating, cursor);
      return result.ok
        ? { ok: true, items: result.reviews, next: result.nextCursor, total: null, extra: undefined }
        : { ok: false };
    },
  });

  return (
    <>
      <ul className="divide-y rounded-md border bg-surface shadow-card">
        {pages.items.map((review) => (
          <li key={review.id} className="p-md">
            <ReviewRow review={review} t={t} locale={locale} />
          </li>
        ))}
      </ul>
      {pages.error ? (
        <p role="alert" className="text-caption font-medium text-danger">
          {t("reviews.loadError")}
        </p>
      ) : null}
      {pages.hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={pages.showMore} disabled={pages.loading}>
            {t("common.showMore")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
