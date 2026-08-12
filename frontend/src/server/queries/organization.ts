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
  emailMasked: string;
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
    .select("id, email, status, token, primary_branch_id, expires_at, accepted_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    emailMasked: maskEmail(r.email),
    status: r.status,
    token: r.token,
    primaryBranchId: r.primary_branch_id,
    expiresAt: r.expires_at,
    acceptedAt: r.accepted_at,
  }));
}
