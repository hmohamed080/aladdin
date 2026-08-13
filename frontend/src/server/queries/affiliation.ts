import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * Reads for the showroom-affiliation flows. Every one of them goes through a
 * trusted security-definer RPC rather than a table select, for the same reason in
 * each case: the caller is deliberately NOT a member of the organization yet, so
 * RLS on `organizations` correctly hides the row they are trying to find. The RPCs
 * return only the approved public business-directory columns, so "I can search for
 * my employer" never becomes "I can read a stranger's tenant data".
 */

type ShowroomRow = Database["public"]["Functions"]["showroom_directory_search"]["Returns"][number];

export type ShowroomResult = {
  id: string;
  name: string;
  orgType: string;
  isVerified: boolean;
};

export type ShowroomBranch = { id: string; name: string };

/** Search showrooms by name. A query under 2 characters returns nothing. */
export async function searchShowrooms(query: string): Promise<ShowroomResult[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("showroom_directory_search", { p_query: query });
  if (error) return [];
  return (data ?? []).map((o: ShowroomRow) => ({
    id: o.id,
    name: o.name,
    orgType: o.org_type,
    isVerified: o.is_verified,
  }));
}

/** The active branches of one showroom, so a salesperson can say where they work. */
export async function showroomBranches(organizationId: string): Promise<ShowroomBranch[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("showroom_branches", { p_org_id: organizationId });
  if (error) return [];
  return (data ?? []).map((b) => ({ id: b.id, name: b.name }));
}

export type ReferralDraft = {
  id: string;
  legalName: string | null;
  displayName: string | null;
  governorate: string | null;
  city: string | null;
  primaryBranchName: string | null;
  description: string | null;
  status: Database["public"]["Enums"]["referral_status"];
};

/**
 * The caller's resumable referral, so a half-filled candidate survives a closed
 * tab. A submitted one is returned too — the form then shows it read-only rather
 * than inviting a second submission.
 */
export async function getOpenReferral(): Promise<ReferralDraft | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_showroom_referrals");
  if (error || !data) return null;
  const open = data.find((f) => f.status === "draft") ?? data.find((f) => f.status === "submitted");
  if (!open) return null;
  return {
    id: open.id,
    legalName: open.legal_name ?? null,
    displayName: open.display_name ?? null,
    governorate: open.governorate ?? null,
    city: open.city ?? null,
    primaryBranchName: open.primary_branch_name ?? null,
    description: open.description ?? null,
    status: open.status,
  };
}

export type JoinRequestRow = {
  requestId: string;
  userId: string;
  displayName: string;
  emailMasked: string;
  persona: string | null;
  note: string | null;
  branchId: string | null;
  branchName: string | null;
  status: Database["public"]["Enums"]["affiliation_request_status"];
  reason: string | null;
  createdAt: string;
};

/**
 * Affiliation requests addressed to one organization, for its existing team
 * surface. Manager-gated inside the RPC by `org.members.manage` — the same
 * capability that gates the members roster, not a second permission model.
 */
export async function listJoinRequests(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<JoinRequestRow[]> {
  const { data, error } = await supabase.rpc("org_join_requests_list", { p_org_id: organizationId });
  if (error) return [];
  return (data ?? []).map((r) => ({
    requestId: r.request_id,
    userId: r.user_id,
    displayName: r.display_name,
    emailMasked: r.email_masked ?? "",
    persona: r.persona ?? null,
    note: r.note ?? null,
    branchId: r.branch_id ?? null,
    branchName: r.branch_name ?? null,
    status: r.status,
    reason: r.decision_reason ?? null,
    createdAt: r.created_at,
  }));
}

export type AdminReferralRow = {
  id: string;
  displayName: string | null;
  legalName: string | null;
  orgType: string;
  description: string | null;
  governorate: string | null;
  city: string | null;
  primaryBranchName: string | null;
  status: Database["public"]["Enums"]["referral_status"];
  reason: string | null;
  organizationId: string | null;
  organizationName: string | null;
  referrerName: string;
  referrerEmail: string;
  referrerPersona: string | null;
  createdAt: string;
  /** De-duplication hint: the closest existing organization of the same type. */
  matchCount: number;
  matchId: string | null;
  matchName: string | null;
};

/**
 * The platform review queue for referred showrooms, including the referring
 * salesperson and the closest existing organization of the same classification.
 * The match is a HINT for a human, never an automatic merge — two genuinely
 * different showrooms may share a name, which is why company name is not unique.
 */
export async function listAdminReferrals(
  supabase: SupabaseClient<Database>,
  pendingOnly = true,
): Promise<AdminReferralRow[]> {
  const { data, error } = await supabase.rpc("admin_showroom_referrals_list", {
    p_pending_only: pendingOnly,
  });
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    displayName: r.display_name ?? null,
    legalName: r.legal_name ?? null,
    orgType: r.org_type,
    description: r.description ?? null,
    governorate: r.governorate ?? null,
    city: r.city ?? null,
    primaryBranchName: r.primary_branch_name ?? null,
    status: r.status,
    reason: r.decision_reason ?? null,
    organizationId: r.organization_id ?? null,
    organizationName: r.organization_name ?? null,
    referrerName: r.referrer_name,
    referrerEmail: r.referrer_email ?? "",
    referrerPersona: r.referrer_persona ?? null,
    createdAt: r.created_at,
    matchCount: r.match_count,
    matchId: r.match_id ?? null,
    matchName: r.match_name ?? null,
  }));
}
