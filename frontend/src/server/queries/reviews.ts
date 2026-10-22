import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { summarizeReviewCounts, type RatingSummary } from "@/lib/reviews/summary";
import { decodeReviewCursor, encodeReviewCursor } from "@/lib/reviews/cursor";

/**
 * Reads for the review domain.
 *
 * I/O ONLY. Both projections already answer the questions that matter — the
 * installer's own visible reviews, and the reviews of a currently listed
 * professional — and both exclude suppressed rows in SQL, so nothing here
 * filters. That is deliberate: a suppression honoured by a query is a suppression
 * a future query can forget, and the moderation state is not readable from here
 * anyway.
 *
 * The summary is derived from the SAME array the caller renders (§9), so a count
 * and a list cannot disagree.
 */

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  /** The reviewing ORGANIZATION. There is no employee name to show. */
  orgName: string;
  jobTitle: string;
  tradeKey: string;
  createdAt: string;
};

function toReview(r: {
  id: string | null;
  rating: number | null;
  comment: string | null;
  org_name: string | null;
  job_title: string | null;
  trade_key: string | null;
  created_at: string | null;
}): Review | null {
  // Every column of a view is nullable to the type generator whatever the table
  // says. Narrowing on the four a card cannot render without means an incomplete
  // row is skipped rather than drawn as a blank review.
  if (!r.id || r.rating === null || !r.org_name || !r.created_at) return null;
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    orgName: r.org_name,
    jobTitle: r.job_title ?? "",
    tradeKey: r.trade_key ?? "",
    createdAt: r.created_at,
  };
}

/** How many of the caller's own reviews one page carries. */
export const REVIEW_PAGE_STEP = 10;

type ReviewRowData = Parameters<typeof toReview>[0];

/** Only the part of the Supabase client the paged read uses, so the read is testable without a database. */
type ReviewQuery = {
  select: (columns: string) => ReviewQuery;
  eq: (column: string, value: number) => ReviewQuery;
  or: (filters: string) => ReviewQuery;
  order: (column: string, options: { ascending: boolean }) => ReviewQuery;
  limit: (count: number) => PromiseLike<{ data: ReviewRowData[] | null; error: unknown }>;
};
export type ReviewReader = { from: (relation: "my_job_reviews") => ReviewQuery };

export type ReviewsPage = { reviews: Review[]; nextCursor: string | null };
export type ReviewOrder = "newest" | "oldest" | "highest";
export type ReviewPageOptions = {
  rating?: number | null;
  after?: string | null;
  limit?: number;
  /** newest (default) = created_at DESC, id DESC · oldest = ASC · highest = rating DESC, then newest. All TOTAL orders. */
  order?: ReviewOrder;
  /** Free text over the reviewing organization, the job title and the comment (case-insensitive). */
  q?: string | null;
  /** Inclusive calendar-day bounds (YYYY-MM-DD) on when the review was written. */
  from?: string | null;
  to?: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A search term is placed inside a PostgREST filter: keep letters, digits, spaces and a few safe marks only. */
export function sanitizeReviewSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.normalize("NFKC").replace(/[^\p{L}\p{N}\s@.\-_'’]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * One page of the caller's own reviews, newest first, by KEYSET and never by offset.
 *
 * The order is `created_at DESC, id DESC`, a total order, so a page ends on exactly one row and the next
 * page starts strictly after it: `created_at < c OR (created_at = c AND id < i)`. Every page is stable under
 * inserts (a new review never shifts or repeats a row), costs the same on page 50 as on page 1, and has no
 * ceiling: the list has more exactly while the last page returned a cursor. One extra row is read to know
 * that without a count.
 *
 * `rating` (1-5) narrows the list IN SQL, so a filtered view pages through every matching review rather
 * than filtering a loaded window. The cursor is validated strictly (`lib/reviews/cursor`) because its two
 * values are placed in a filter expression; an invalid one throws and the caller refuses it. Scope is
 * unchanged: `my_job_reviews` holds the caller's own, already-visible reviews and never a suppressed one.
 */
export async function listMyReviewsPageFrom(supabase: ReviewReader, opts: ReviewPageOptions = {}): Promise<ReviewsPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? REVIEW_PAGE_STEP), 1), 50);
  const order: ReviewOrder = opts.order === "oldest" || opts.order === "highest" ? opts.order : "newest";
  const after = opts.after ? decodeReviewCursor(opts.after) : null;
  if (opts.after && !after) throw new Error("invalid review cursor");
  if (after && (order === "highest") !== (after.rating !== undefined)) throw new Error("cursor does not match the order");
  const rating = opts.rating ?? null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error("invalid rating");
  const from = opts.from && DAY.test(opts.from) ? opts.from : null;
  const to = opts.to && DAY.test(opts.to) ? opts.to : null;
  const q = sanitizeReviewSearch(opts.q);

  let query = supabase.from("my_job_reviews").select("id, rating, comment, org_name, job_title, trade_key, created_at");
  if (rating !== null) query = query.eq("rating", rating);
  if (from) query = query.or(`created_at.gte.${from}T00:00:00Z`);
  if (to) query = query.or(`created_at.lt.${nextDay(to)}T00:00:00Z`);
  if (q) {
    const term = `*${q.replace(/\s/g, "*")}*`;
    query = query.or(`org_name.ilike.${term},job_title.ilike.${term},comment.ilike.${term}`);
  }
  if (after) {
    const cmp = order === "oldest" ? "gt" : "lt";
    const time = `created_at.${cmp}.${after.createdAt},and(created_at.eq.${after.createdAt},id.${cmp}.${after.id})`;
    query = query.or(
      order === "highest"
        ? `rating.lt.${after.rating},and(rating.eq.${after.rating},or(${time}))`
        : time,
    );
  }
  if (order === "highest") query = query.order("rating", { ascending: false });
  const { data, error } = await query
    .order("created_at", { ascending: order === "oldest" })
    .order("id", { ascending: order === "oldest" })
    .limit(limit + 1);
  if (error) throw error;

  const fetched = data ?? [];
  const page = fetched.slice(0, limit);
  const reviews = page.flatMap((r) => {
    const review = toReview(r);
    return review ? [review] : [];
  });
  // The cursor comes from the last row READ, not the last row RENDERED, so a row `toReview` skipped as
  // incomplete can never make the next page start at it again.
  const lastRead = page[page.length - 1];
  const nextCursor =
    fetched.length > limit && lastRead?.created_at && lastRead.id
      ? encodeReviewCursor({
          createdAt: lastRead.created_at,
          id: lastRead.id,
          ...(order === "highest" && lastRead.rating !== null ? { rating: lastRead.rating } : {}),
        })
      : null;
  return { reviews, nextCursor };
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The caller's own reviews, one page (see `listMyReviewsPageFrom`). */
export async function listMyReviewsPage(opts: ReviewPageOptions = {}): Promise<ReviewsPage> {
  const supabase = await getServerSupabase();
  return listMyReviewsPageFrom(supabase as unknown as ReviewReader, opts);
}

/**
 * The caller's own summary over the WHOLE set: exact, and without reading the rows.
 *
 * One COUNT per star (head requests, so no rows travel), then the same arithmetic `summarizeReviews` uses,
 * over the database's exact counts. The average, the total and the distribution stay right however many
 * reviews exist. `cache()`d per render: the Reviews page, the profile hub and Home share one read.
 */
export const loadMyReviewSummary = cache(async function loadMyReviewSummary(): Promise<RatingSummary> {
  const supabase = await getServerSupabase();
  const stars = [1, 2, 3, 4, 5] as const;
  const counts = await Promise.all(
    stars.map(async (rating) => {
      const { count, error } = await supabase
        .from("my_job_reviews")
        .select("id", { count: "exact", head: true })
        .eq("rating", rating);
      if (error) throw error;
      return count ?? 0;
    }),
  );
  return summarizeReviewCounts({ 1: counts[0]!, 2: counts[1]!, 3: counts[2]!, 4: counts[3]!, 5: counts[4]! });
});

/**
 * One professional's public reviews, for `/p/[profileId]`.
 *
 * Reachable while signed out. Returns nothing for an unlisted profile — the same
 * answer it gives for a listed professional with no reviews, which is the point:
 * a visitor must not be able to tell those apart.
 */
export async function loadPublicReviews(profileId: string): Promise<Review[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("public_profile_reviews")
    .select("id, rating, comment, org_name, job_title, trade_key, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (error || !data) return [];
  return data.flatMap((r) => {
    const review = toReview(r);
    return review ? [review] : [];
  });
}

/**
 * The review of ONE assignment, for the two surfaces that show a single one: the
 * poster's completed job, and the installer's completed assignment detail.
 *
 * Reads `job_reviews` directly rather than through a projection, because both
 * callers are already a party — `job_reviews_select_installer` and
 * `job_reviews_select_poster` admit exactly them — and neither needs the
 * organization name a projection would join for (the poster IS the organization,
 * and the installer's page already names it).
 *
 * Returns null both when no review exists and when the caller may not see one.
 * The surfaces read that as "no review yet", which is correct for every caller
 * who could reach them.
 */
export const loadAssignmentReview = cache(async function loadAssignmentReview(
  assignmentId: string,
): Promise<{ rating: number; comment: string | null; createdAt: string } | null> {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("job_reviews")
    .select("rating, comment, created_at")
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!data) return null;
  return { rating: data.rating, comment: data.comment, createdAt: data.created_at };
});

export type ReviewMonth = { month: string; reviews: number; average: number | null };

/** The caller's own monthly count and average for the last `months` months (exact, in SQL; see `my_review_monthly`). */
export async function loadMyReviewMonthly(months = 6): Promise<ReviewMonth[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_review_monthly", { p_months: months });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    month: row.month,
    reviews: row.reviews,
    // The generator types an aggregate as non-null; a month with no review returns NULL.
    average: (row.average as number | null) === null ? null : Number(row.average),
  }));
}
