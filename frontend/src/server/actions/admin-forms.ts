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

type Supa = Awaited<ReturnType<typeof getServerSupabase>>;

/**
 * The decision is made on what the DATABASE says the request is — never on `status` / `verificationType`
 * echoed back by the browser. A stale tab or a tampered field could otherwise skip the apply step or claim
 * the wrong state. RLS scopes the read to reviewers; no row (or a business verification, which has its own
 * queue and RPCs) is reported as a state error, not as a missing permission.
 */
async function loadDecisionTarget(
  supabase: Supa,
  id: string,
): Promise<{ status: string; verificationType: string } | null> {
  const { data, error } = await supabase
    .from("verifications")
    .select("status, verification_type")
    .eq("id", id)
    .neq("verification_type", "business")
    .maybeSingle();
  if (error || !data) return null;
  return { status: data.status, verificationType: data.verification_type };
}

/** Ensure the verification is claimed by the caller before a decision. */
async function ensureStarted(supabase: Supa, id: string, currentStatus: string): Promise<string | null> {
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
  revalidatePath("/admin/users");
  return { ok: true, code: "admin.review.started" };
}

/**
 * Approve, then APPLY. `review_approve` only records the decision; the effect on
 * the subject is a separate, idempotent apply step — `apply_account_upgrade` for a
 * professional user, `apply_organization_verification` for an organization. Without
 * it an approval changed nothing about the account or the organization.
 *
 * Retry-safe: `review_approve` is itself idempotent for an ALREADY-approved request — it returns without changes
 * only for the assigned reviewer and refuses everyone else (and the applicant themself), so it is always called
 * and the reviewer restrictions stay enforced on the retry path. The apply step then runs again (both apply RPCs
 * return early once `applied_at` is set), which repairs an approval whose apply failed the first time and makes a
 * repeated click a no-op. Rejected / withdrawn requests still fail with the state error. The apply RPCs only check
 * the `users.verify` / `organizations.verify` permission, so the reviewer gate here is what keeps a retry from being
 * driven by an admin who did not make the decision.
 *
 * Public listing is only meaningful for a professional upgrade (the database
 * constraint `ck_verifications_listing_only_professional` rejects it on any other
 * subject), so it is requested only there. It is REVIEWER-SET (ADR-0007 D14): the Users dialogs show an explicit
 * "list publicly" choice (`listingChoice=1`, `grantListing=on` only when ticked); a form that offers no choice (the
 * Verifications queue) keeps its historical behaviour of listing a professional approval. Listing also publishes the person's
 * public portfolio media, so it is never inferred from anything else. It cannot be changed by a retry: the flag is
 * recorded once, when the decision is made.
 */
export async function approveVerificationAction(
  _p: ReviewFormState,
  fd: FormData,
): Promise<ReviewFormState> {
  const id = str(fd, "id");
  if (!id) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();

  const target = await loadDecisionTarget(supabase, id);
  if (!target) return { ok: false, code: "admin.review.error.state" };
  const isProfessional = target.verificationType === "professional";
  // `listingChoice` marks a form that SHOWED the choice: then only a ticked box (`grantListing=on`) lists. A form
  // that offers no choice (the Verifications queue) keeps the historical default for a professional approval.
  const grantListing = isProfessional && (str(fd, "listingChoice") ? str(fd, "grantListing") === "on" : true);

  const startErr = await ensureStarted(supabase, id, target.status);
  if (startErr) return { ok: false, code: startErr };

  const { error } = await supabase.rpc("review_approve", {
    p_verification_id: id,
    p_grant_public_listing: grantListing,
  });
  if (error) return { ok: false, code: mapReviewError(error.message) };

  // An `identity` verification has no subject effect to apply yet.
  if (isProfessional || target.verificationType === "organization") {
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

  const target = await loadDecisionTarget(supabase, id);
  if (!target) return { ok: false, code: "admin.review.error.state" };

  const startErr = await ensureStarted(supabase, id, target.status);
  if (startErr) return { ok: false, code: startErr };

  const { error } = await supabase.rpc("review_reject", { p_verification_id: id, p_reason: reason });
  if (error) return { ok: false, code: mapReviewError(error.message) };
  revalidatePath("/admin/verifications");
  revalidatePath("/admin/users");
  return { ok: true, code: "admin.review.rejected" };
}
