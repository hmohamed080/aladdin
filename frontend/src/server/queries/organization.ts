import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read-models for the organization people-management screen. Members come from
 * the trusted, manager-gated `org_members_list` RPC (identity is masked and
 * capability/branch scope is joined server-side, since a manager may not read a
 * co-member's identity rows directly). Invitations are read straight from
 * `organization_invitations` (already manager-readable under RLS).
 */

type Client = SupabaseClient<Database>;

export type OrgMember = {
  membershipId: string;
  userId: string;
  displayName: string;
  emailMasked: string;
  /** Personal persona, or null for a business-only identity (Sprint 12). */
  accountType: string | null;
  status: "invited" | "active" | "suspended" | "revoked";
  primaryBranchId: string | null;
  branchIds: string[];
  capabilities: string[];
  invitedAt: string | null;
  acceptedAt: string | null;
};

export type OrgInvitation = {
  id: string;
  /** Which contact this invitation was addressed to — exactly one, never both. */
  channel: "email" | "phone";
  /** Masked for display. The roster shows who was invited, not their address. */
  contactMasked: string;
  status: string;
  token: string;
  primaryBranchId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
};

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/**
 * Country code and last two digits, e.g. +201002003040 -> `+20•••40`. The same
 * shape `app.mask_phone` produces on the invitee's own entry screen, so a
 * manager and an invitee are looking at the same rendering of one number.
 */
function maskPhone(phone: string): string {
  if (phone.length < 6) return "•••";
  return `${phone.slice(0, 3)}•••${phone.slice(-2)}`;
}

export async function listOrgMembers(supabase: Client, orgId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase.rpc("org_members_list", { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    displayName: r.display_name,
    emailMasked: r.email_masked ?? "",
    accountType: r.primary_account_type,
    status: r.status,
    primaryBranchId: r.primary_branch_id,
    branchIds: r.branch_ids ?? [],
    capabilities: r.capabilities ?? [],
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
  }));
}

export async function listOrgInvitations(supabase: Client, orgId: string): Promise<OrgInvitation[]> {
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, phone, status, token, primary_branch_id, expires_at, accepted_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    // `ck_invitation_contact` guarantees exactly one is set, so the email branch
    // is the only test needed and there is no third "neither" case to render.
    channel: r.email ? ("email" as const) : ("phone" as const),
    contactMasked: r.email ? maskEmail(r.email) : maskPhone(r.phone ?? ""),
    status: r.status,
    token: r.token,
    primaryBranchId: r.primary_branch_id,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
  }));
}
