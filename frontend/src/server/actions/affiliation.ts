"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Writers for showroom affiliation. Thin, shape-only validators over the trusted
 * security-definer RPCs: the verified-caller gate, the "is this really a showroom"
 * check, branch-belongs-to-org, idempotency, the capability check on approval and
 * the platform-authority check on referral review all live in the database.
 *
 * The actor is NEVER a parameter. Every RPC derives it from `auth.uid()`, so there
 * is no code path here — or anywhere — that accepts a client-supplied user id.
 */
export type AffiliationState = { ok: boolean; code?: string; id?: string };

const uuid = z.string().uuid();

/* --------------------------- the salesperson's side --------------------------- */

/**
 * Ask to join an existing showroom. Creates a REQUEST and nothing else: no
 * membership, no capability, no workspace. Idempotent per (caller, showroom), so a
 * double-submitted form does not queue a duplicate for the approver.
 */
export async function requestShowroomAffiliation(formData: FormData): Promise<void> {
  const organizationId = uuid.safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/home/showroom?error=1");

  const branchRaw = formData.get("branchId");
  const branchId = typeof branchRaw === "string" && uuid.safeParse(branchRaw).success ? branchRaw : undefined;
  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw.trim().slice(0, 500) : undefined;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("showroom_join_request_create", {
    p_organization_id: organizationId.data,
    p_branch_id: branchId,
    p_note: note,
  });
  if (error) redirect("/home/showroom?error=1");

  revalidatePath("/home");
  redirect("/home?connected=pending");
}

/** Withdraw one's own open request. */
export async function cancelShowroomRequest(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("requestId"));
  if (id.success) {
    const supabase = await getServerSupabase();
    await supabase.rpc("showroom_join_request_cancel", { p_request_id: id.data });
  }
  revalidatePath("/home");
  redirect("/home");
}

const referralSchema = z.object({
  referralId: z.string().uuid().nullish(),
  legalName: z.string().trim().max(120).nullish(),
  displayName: z.string().trim().max(120).nullish(),
  description: z.string().trim().max(1000).nullish(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  primaryBranchName: z.string().trim().max(120).nullish(),
});

function referralFrom(formData: FormData) {
  const read = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  return referralSchema.safeParse({
    referralId: read("referralId"),
    legalName: read("legalName"),
    displayName: read("displayName"),
    description: read("description"),
    governorate: read("governorate"),
    city: read("city"),
    primaryBranchName: read("primaryBranchName"),
  });
}

/**
 * Refer the showroom the salesperson works for, when it is not on Aladdin yet.
 *
 * This is NOT the "Add Business" owner flow and it must never behave like one: no
 * organization is created, the salesperson does not become Owner, and no B2B access
 * follows. It records a candidate for platform review, attributed to the referrer.
 *
 * Save and submit are one action because the form is one screen; the draft is still
 * written first, so a failed submit leaves resumable work rather than nothing.
 */
export async function submitShowroomReferral(formData: FormData): Promise<void> {
  const parsed = referralFrom(formData);
  if (!parsed.success) redirect("/home/showroom/refer?error=1");
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { data: referralId, error: saveError } = await supabase.rpc("showroom_referral_save", {
    p_referral_id: v.referralId ?? undefined,
    p_legal_name: v.legalName ?? undefined,
    p_display_name: v.displayName ?? undefined,
    p_description: v.description ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_primary_branch_name: v.primaryBranchName ?? undefined,
  });
  if (saveError) redirect("/home/showroom/refer?error=1");

  const { error: submitError } = await supabase.rpc("showroom_referral_submit", {
    p_referral_id: referralId ?? undefined,
  });
  // A validation failure leaves a saved DRAFT, so the salesperson resumes rather
  // than retypes.
  if (submitError) redirect("/home/showroom/refer?error=required");

  revalidatePath("/home");
  redirect("/home?connected=submitted");
}

/* ------------------------------ the showroom's side ------------------------------ */

/**
 * Approve an affiliation request. Activates exactly one Sales membership through
 * the shared trusted path, preserving branch scope. Requires
 * `org.members.manage` in the request's OWN organization — checked in the RPC, so a
 * manager of another business cannot reach the row.
 */
export async function approveJoinRequest(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("requestId"));
  if (!id.success) redirect("/b2b/organization?error=1");

  const branchRaw = formData.get("branchId");
  const branchId = typeof branchRaw === "string" && uuid.safeParse(branchRaw).success ? branchRaw : undefined;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("org_join_request_approve", {
    p_request_id: id.data,
    p_branch_id: branchId,
  });
  if (error) redirect("/b2b/organization?error=approve");

  revalidatePath("/b2b/organization");
  redirect("/b2b/organization?joined=1");
}

/** Reject an affiliation request, with a reason. The personal account is untouched. */
export async function rejectJoinRequest(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("requestId"));
  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!id.success || reason === "") redirect("/b2b/organization?error=reason");

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("org_join_request_reject", {
    p_request_id: id.data,
    p_reason: reason.slice(0, 500),
  });
  if (error) redirect("/b2b/organization?error=reject");

  revalidatePath("/b2b/organization");
  redirect("/b2b/organization?decided=1");
}

/* ---------------------------------- the platform ---------------------------------- */

/**
 * Approve a referred showroom. Links it to an existing organization when the Admin
 * says so (or when the name matches one exactly), otherwise materialises it. Either
 * way the referring salesperson ends as a Sales MEMBER, never Owner, and a repeated
 * approval can never produce a second business.
 */
export async function approveReferral(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("referralId"));
  if (!id.success) redirect("/admin/verifications?error=1");

  const linkRaw = formData.get("linkOrganizationId");
  const linkId = typeof linkRaw === "string" && uuid.safeParse(linkRaw).success ? linkRaw : undefined;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("showroom_referral_approve", {
    p_referral_id: id.data,
    p_link_organization_id: linkId,
  });
  if (error) redirect("/admin/verifications?error=approve");

  revalidatePath("/admin/verifications");
  redirect("/admin/verifications?referral=approved");
}

/** Reject a referred showroom, with a reason. */
export async function rejectReferral(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("referralId"));
  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!id.success || reason === "") redirect("/admin/verifications?error=reason");

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("showroom_referral_reject", {
    p_referral_id: id.data,
    p_reason: reason.slice(0, 500),
  });
  if (error) redirect("/admin/verifications?error=reject");

  revalidatePath("/admin/verifications");
  redirect("/admin/verifications?referral=rejected");
}
