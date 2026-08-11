"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Admin verification actions. Every decision goes through the trusted `review_*`
 * RPCs, which enforce platform-reviewer authority (`is_platform('support')`), the
 * no-self-review rule, sticky-reviewer assignment, and the legal state machine —
 * and apply the account/org upgrade transactionally. Nothing is decided here; we
 * only forward the caller JWT and map the outcome to a translation KEY.
 */

export type ReviewFormState = { ok: boolean; code?: string };

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function mapReviewError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("authority")) return "admin.review.error.notAuthorized";
  if (m.includes("own verification")) return "admin.review.error.ownReview";
  if (m.includes("another reviewer")) return "admin.review.error.otherReviewer";
  if (m.includes("invalid transition")) return "admin.review.error.state";
  if (m.includes("reason")) return "admin.review.error.reasonRequired";
  return "states.genericRetry";
}

/** Ensure the verification is claimed by the caller before a decision. */
async function ensureStarted(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  id: string,
  currentStatus: string | undefined,
): Promise<string | null> {
  if (currentStatus !== "submitted" && currentStatus !== "needs_more_info") return null;
  const { error } = await supabase.rpc("review_start", { p_verification_id: id });
  if (error) return mapReviewError(error.message);
  return null;
}

export async function startReviewAction(_p: ReviewFormState, fd: FormData): Promise<ReviewFormState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("review_start", { p_verification_id: id });
  if (error) return { ok: false, code: mapReviewError(error.message) };
  revalidatePath("/admin/verifications");
  return { ok: true, code: "admin.review.started" };
}

/**
 * Approve, then APPLY. `review_approve` only records the decision; the effect on
 * the subject is a separate, idempotent apply step — `apply_account_upgrade` for a
 * professional user, `apply_organization_verification` for an organization. Without
 * it an approval changed nothing about the account or the organization.
 *
 * Public listing is only meaningful for a professional upgrade (the database
 * constraint `ck_verifications_listing_only_professional` rejects it on any other
 * subject), so it is requested only there.
 */
export async function approveVerificationAction(
  _p: ReviewFormState,
  fd: FormData,
): Promise<ReviewFormState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, code: "states.genericRetry" };
  const verificationType = str(fd, "verificationType");
  const isProfessional = verificationType === "professional";
  const supabase = await getServerSupabase();

  const startErr = await ensureStarted(supabase, id, str(fd, "status"));
  if (startErr) return { ok: false, code: startErr };

  const { error } = await supabase.rpc("review_approve", {
    p_verification_id: id,
    p_grant_public_listing: isProfessional,
  });
  if (error) return { ok: false, code: mapReviewError(error.message) };

  // An `identity` verification has no subject effect to apply yet.
  if (isProfessional || verificationType === "organization") {
    const { error: applyError } = isProfessional
      ? await supabase.rpc("apply_account_upgrade", { p_verification_id: id })
      : await supabase.rpc("apply_organization_verification", { p_verification_id: id });
    if (applyError) return { ok: false, code: mapReviewError(applyError.message) };
  }

  revalidatePath("/admin/verifications");
  revalidatePath("/admin/organizations");
  revalidatePath("/admin/users");
  return { ok: true, code: "admin.review.approved" };
}

export async function rejectVerificationAction(
  _p: ReviewFormState,
  fd: FormData,
): Promise<ReviewFormState> {
  const id = str(fd, "id");
  const reason = str(fd, "reason");
  if (!id) return { ok: false, code: "states.genericRetry" };
  if (!reason) return { ok: false, code: "admin.review.error.reasonRequired" };
  const supabase = await getServerSupabase();

  const startErr = await ensureStarted(supabase, id, str(fd, "status"));
  if (startErr) return { ok: false, code: startErr };

  const { error } = await supabase.rpc("review_reject", { p_verification_id: id, p_reason: reason });
  if (error) return { ok: false, code: mapReviewError(error.message) };
  revalidatePath("/admin/verifications");
  return { ok: true, code: "admin.review.rejected" };
}
