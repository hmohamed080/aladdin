"use server";

import { listMyReviewsPage, type ReviewsPage } from "@/server/queries/reviews";

/**
 * "Show more" on the installer's Reviews: the NEXT page of the same question, by CURSOR. The client sends the
 * rating filter (or null) and the opaque cursor the previous page returned. Both are re-validated here — the
 * rating must be a whole star 1–5, the cursor must decode exactly (a hand-made or malformed one is refused) —
 * and the rows are read through the same query as the first render, scoped by the database to the caller.
 * No offset, no ceiling: the list appends until `nextCursor` is null.
 */
export type LoadMoreReviewsResult = ({ ok: true } & ReviewsPage) | { ok: false };

export async function loadMoreReviewsAction(rating: number | null, cursor: string): Promise<LoadMoreReviewsResult> {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 200) return { ok: false };
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return { ok: false };
  try {
    return { ok: true, ...(await listMyReviewsPage({ rating, after: cursor })) };
  } catch {
    return { ok: false };
  }
}

export type ReviewsQueryInput = {
  rating: number | null;
  cursor: string | null;
  order: "newest" | "oldest" | "highest";
  q: string | null;
  from: string | null;
  to: string | null;
};

/**
 * The Installer Reviews workspace (approved design): the first or next keyset page of the caller's own reviews for an
 * order, a free-text search and a date range. Every input is re-validated by the query; a malformed cursor, a cursor
 * from another order, or a bad rating is refused rather than guessed.
 */
export async function loadReviewsPageAction(input: ReviewsQueryInput): Promise<LoadMoreReviewsResult> {
  if (!input || typeof input !== "object") return { ok: false };
  const { rating, cursor, order, q, from, to } = input;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return { ok: false };
  if (cursor !== null && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 200)) return { ok: false };
  if (order !== "newest" && order !== "oldest" && order !== "highest") return { ok: false };
  try {
    return { ok: true, ...(await listMyReviewsPage({ rating, after: cursor, order, q, from, to })) };
  } catch {
    return { ok: false };
  }
}

/** The Installer Reviews page's loader: (query, cursor) -> one keyset page (see `loadReviewsPageAction`). */
export async function loadInstallerReviewsAction(
  query: { order: "newest" | "oldest" | "highest"; q: string; from: string; to: string },
  cursor: string | null,
): Promise<LoadMoreReviewsResult> {
  if (!query || typeof query !== "object") return { ok: false };
  return loadReviewsPageAction({
    rating: null,
    cursor,
    order: query.order,
    q: typeof query.q === "string" ? query.q : null,
    from: typeof query.from === "string" && query.from ? query.from : null,
    to: typeof query.to === "string" && query.to ? query.to : null,
  });
}
