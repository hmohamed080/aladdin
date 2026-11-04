import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * The token holder's view of an invitation, from the anti-enumeration `staff_invitation_lookup` RPC: a state and, for a live invitation only,
 * the role name and a MASKED address. An unknown, malformed or missing token is "invalid", exactly like a forged one.
 */
export type StaffInvitationView = {
  status: "invalid" | "pending" | "accepted" | "revoked" | "expired";
  roleName: string | null;
  emailMasked: string | null;
  matchesCaller: boolean;
};

const INVALID: StaffInvitationView = { status: "invalid", roleName: null, emailMasked: null, matchesCaller: false };
const STATES = ["invalid", "pending", "accepted", "revoked", "expired"] as const;

export async function lookupStaffInvitation(token: string | null): Promise<StaffInvitationView> {
  if (!token) return INVALID;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("staff_invitation_lookup", { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return INVALID;
  const status = (STATES as readonly string[]).includes(row.status) ? (row.status as StaffInvitationView["status"]) : "invalid";
  return {
    status,
    roleName: status === "pending" ? (row.role_name ?? null) : null,
    emailMasked: status === "pending" ? (row.email_masked ?? null) : null,
    matchesCaller: status === "pending" && Boolean(row.matches_caller),
  };
}

export type StaffInvitationRow = {
  id: string;
  emailMasked: string;
  roleKey: string;
  roleName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
  inviterAuthorized: boolean;
};

/** The staff roster of invitations (admin_staff.read). `null` means the caller may not see it. */
export async function listStaffInvitations(supabase: SupabaseClient<Database>): Promise<StaffInvitationRow[] | null> {
  const { data, error } = await supabase.rpc("admin_staff_invitations_list");
  if (error) return null;
  return (data ?? []).map((r) => ({
    id: r.id,
    emailMasked: r.email_masked,
    roleKey: r.role_key,
    roleName: r.role_name,
    status: (["pending", "accepted", "revoked", "expired"] as const).includes(r.status as "pending") ? (r.status as StaffInvitationRow["status"]) : "expired",
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    invitedByName: r.invited_by_name,
    inviterAuthorized: r.inviter_authorized === true,
  }));
}
