"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapReviewError } from "@/server/actions/error-mapping";

/**
 * Submitting a review.
 *
 * ONE ACTION, and it decides nothing. Every rule lives in `job_review_submit`
 * and cannot be reached another way:
 *
 *   * WHO — `app.can_manage_job` on the posting organization, so the assigned
 *     installer gets the same refusal a stranger does. There is no client grant
 *     to fall back on.
 *   * WHEN — the assignment must be `completed`. Work reported finished at 100%
 *     is still not completed (Increment 9), and the RPC honours that line.
 *   * HOW MANY — `assignment_id` is unique, and the RPC returns the existing
 *     review rather than raising, so a double submit converges on the first one.
 *   * WHAT — the 1–5 range is a CHECK on the table, not a branch here, so no
 *     caller can reach the column another way.
 *
 * There is deliberately no update action and no delete action. Not "not yet" —
 * the table refuses both for everybody, so there is nothing for this file to
 * call. A correction is a moderation act, and moderation has no client path at
 * all in this increment.
 */
export type ReviewState = { ok: boolean; code?: string };

export async function submitReviewAction(
  _prev: ReviewState,
  fd: FormData,
): Promise<ReviewState> {
  const assignmentId = String(fd.get("assignmentId") ?? "");
  const rating = Number(fd.get("rating"));

  // A missing choice is worth naming here rather than sending an empty rating to
  // Postgres to be refused as a constraint violation — the person simply has not
  // picked yet, which is not an error about their data.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: "reviews.errors.ratingRequired" };
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("job_review_submit", {
    p_assignment_id: assignmentId,
    p_rating: rating,
    p_comment: String(fd.get("comment") ?? ""),
  });

  if (error) return { ok: false, code: mapReviewError(error) };

  // The poster's surface, and the two the reviewed professional will look at.
  revalidatePath(`/b2b/jobs`);
  revalidatePath("/home/reviews");
  revalidatePath("/home/profile");
  return { ok: true };
}
