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
  if (m.includes("another reviewer") || m.includes("assigned reviewer")) return "admin.review.error.otherReviewer";
  // The database refuses to approve a showroom whose business profile is incomplete (phone, activity, address).
  if (m.includes("complete showroom business information")) return "admin.review.error.incompleteProfile";
  if (m.includes("already holds an approved")) return "admin.review.error.alreadyVerified";
  if (m.includes("professional account can be verified") || m.includes("not active") || m.includes("not awaiting approval")
      || m.includes("no active owner") || m.includes("subject not found") || m.includes("own account") || m.includes("own organization"))
    return "admin.review.error.notEligible";
  if (m.includes("invalid transition")) return "admin.review.error.state";
  if (m.includes("at most 2000") || m.includes("at most 500")) return "admin.review.error.reasonTooLong";
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

/**
 * Approve / Reject work directly on an account that has NO request yet: the Admin presses one button, the request is filed
 * through the existing authorized `admin_initiate_verification` function (permission, tier, eligibility, audit row) and
 * then decided through the unchanged review_start / review_approve / review_reject steps. An open request is reused,
 * never duplicated. When the form carries a request id it is used as is.
 */
type ApprovedUnapplied = { found: true; id: string } | { found: false } | { error: true };

/**
 * The newest request of this subject that is APPROVED but whose apply step never completed. A read error is reported as
 * an error, never as "none": the callers FAIL CLOSED on it (a lookup failure must never lead to a new request).
 */
async function findApprovedUnapplied(supabase: Supa, subjectType: "user" | "organization", subjectId: string): Promise<ApprovedUnapplied> {
  const res = await supabase
    .from("verifications")
    .select("id")
    .eq("subject_type", subjectType)
    .eq(subjectType === "user" ? "user_id" : "organization_id", subjectId)
    .eq("status", "approved")
    .is("applied_at", null)
    // Only the types whose approval has an apply step can be "unapplied": identity and business approvals never set applied_at.
    .eq("verification_type", subjectType === "user" ? "professional" : "organization")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!res || res.error) return { error: true };
  return res.data?.id ? { found: true, id: res.data.id } : { found: false };
}

async function resolveVerificationId(
  supabase: Supa,
  fd: FormData,
  mode: "approve" | "reject",
): Promise<{ id: string } | { code: string }> {
  const id = str(fd, "id");
  if (id) return { id };
  const subjectType = str(fd, "subjectType");
  const subjectId = str(fd, "subjectId");
  if ((subjectType !== "user" && subjectType !== "organization") || !subjectId || !UUID.test(subjectId)) {
    return { code: "states.genericRetry" };
  }
  // RECOVERY: a previous Approve may have recorded the decision and then failed before the apply step. That request is
  // APPROVED but not applied, so it is no longer "open" and filing a new one would duplicate the request, the audit trail
  // and the owner's notification. Approve resumes the SAME request (approve and apply are idempotent); Reject is refused
  // (the recovery offers Approve only). If the lookup itself fails the action stops: it never falls back to a new request.
  const unapplied = await findApprovedUnapplied(supabase, subjectType, subjectId);
  if ("error" in unapplied) return { code: "states.genericRetry" };
  if (unapplied.found) return mode === "approve" ? { id: unapplied.id } : { code: "admin.review.error.state" };
  const { data, error } = await supabase.rpc("admin_initiate_verification", { p_subject_type: subjectType, p_subject_id: subjectId });
  if (error) return { code: mapReviewError(error.message) };
  const state = (data as { state?: unknown; verification_id?: unknown } | null);
  const vid = typeof state?.verification_id === "string" ? state.verification_id : null;
  if ((state?.state !== "initiated" && state?.state !== "already_open") || !vid) return { code: "states.genericRetry" };
  return { id: vid };
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
 * subject), so it is requested only there. It is REVIEWER-SET (ADR-0007 D14) and OPT-IN: every approval form (the
 * Users dialogs and the Verifications queue) shows an explicit "list publicly" checkbox, unticked by default, and only
 * `grantListing=on` lists. Listing also publishes the person's public portfolio media, so a missing field, a forged
 * request or a non-professional subject never lists. (Historically the queue listed professionals by default.) It
 * cannot be changed by a retry: the flag is recorded once, when the decision is made.
 */
export async function approveVerificationAction(
  _p: ReviewFormState,
  fd: FormData,
): Promise<ReviewFormState> {
  const supabase = await getServerSupabase();
  const resolved = await resolveVerificationId(supabase, fd, "approve");
  if (!("id" in resolved)) return { ok: false, code: resolved.code };
  const id = resolved.id;

  const target = await loadDecisionTarget(supabase, id);
  if (!target) return { ok: false, code: "admin.review.error.state" };
  const resumed = target.status === "approved";
  const isProfessional = target.verificationType === "professional";
  // Opt-in: only an explicitly ticked box lists, and only a professional upgrade can be listed.
  const grantListing = isProfessional && str(fd, "grantListing") === "on";

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
  // A request that was ALREADY approved when this action read it is a completion (recovery or repeated click): the owner was
  // informed by the first approval, so the toast must not claim a fresh notification.
  return { ok: true, code: resumed ? "admin.review.approvalCompleted" : "admin.review.approved" };
}

export async function rejectVerificationAction(
  _p: ReviewFormState,
  fd: FormData,
): Promise<ReviewFormState> {
  // The reason is OPTIONAL: when given it is shown to the account owner and sent in their notification.
  const reason = str(fd, "reason") ?? "";
  if (reason.length > 2000) return { ok: false, code: "admin.review.error.reasonTooLong" };
  const supabase = await getServerSupabase();
  const resolved = await resolveVerificationId(supabase, fd, "reject");
  if (!("id" in resolved)) return { ok: false, code: resolved.code };
  const id = resolved.id;

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An authorized Admin starts a verification when the owner has not submitted one. The database function does ALL the
 * checking (permission, tier, eligibility, duplicates) and records the audit row with the reason; this only validates
 * the shape and maps the outcome to a translation KEY. It decides nothing: the request then goes through the same
 * review_start / review_approve / review_reject steps as any other.
 */
export async function adminInitiateVerificationAction(_p: ReviewFormState, fd: FormData): Promise<ReviewFormState> {
  const subjectType = str(fd, "subjectType");
  const subjectId = str(fd, "subjectId");
  const reason = str(fd, "reason") ?? ""; // optional note for the audit row
  if ((subjectType !== "user" && subjectType !== "organization") || !subjectId || !UUID.test(subjectId)) {
    return { ok: false, code: "states.genericRetry" };
  }
  if (reason.length > 500) return { ok: false, code: "admin.review.error.reasonTooLong" };

  const supabase = await getServerSupabase();
  // Never file a NEW request over an approved-but-unapplied one (the Admin resumes it with Approve instead).
  const unapplied = await findApprovedUnapplied(supabase, subjectType, subjectId);
  if ("error" in unapplied) return { ok: false, code: "states.genericRetry" };
  if (unapplied.found) return { ok: false, code: "admin.review.error.state" };
  const { data, error } = await supabase.rpc("admin_initiate_verification", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_reason: reason || undefined,
  });
  if (error) return { ok: false, code: mapReviewError(error.message) };
  const state = (data as { state?: unknown } | null)?.state;
  if (state !== "initiated" && state !== "already_open") return { ok: false, code: "states.genericRetry" };

  revalidatePath("/admin/verifications");
  revalidatePath("/admin/organizations");
  revalidatePath("/admin/users");
  return { ok: true, code: state === "initiated" ? "admin.review.initiated" : "admin.review.alreadyOpen" };
}
