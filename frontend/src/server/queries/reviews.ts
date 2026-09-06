import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { summarizeReviews, type RatingSummary } from "@/lib/reviews/summary";

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

/**
 * The caller's own reviews, newest first.
 *
 * `cache()`d per render: the Reviews page reads it, and so does the profile hub's
 * summary in the same tree. One read, one source, no disagreement.
 */
export const listMyReviews = cache(async function listMyReviews(): Promise<Review[]> {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("my_job_reviews")
    .select("id, rating, comment, org_name, job_title, trade_key, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  return (data ?? []).flatMap((r) => {
    const review = toReview(r);
    return review ? [review] : [];
  });
});

/** The caller's own summary, from the same rows the list shows. */
export const loadMyReviewSummary = cache(async function loadMyReviewSummary(): Promise<RatingSummary> {
  return summarizeReviews(await listMyReviews());
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
