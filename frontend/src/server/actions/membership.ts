import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Trusted organization membership & branch-assignment boundaries (Sprint 2).
 *
 * Thin wrappers over the server-side RPCs. Authorization (capability checks,
 * no-escalation, last-owner protection, tenant matching), transactionality, and
 * audit emission all live in the database functions (ADR-0007). The client only
 * forwards the CALLER's JWT via a caller-scoped server client; unauthorized
 * callers are rejected by the database. No service-role key is used here.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, rpcName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${rpcName} returned an invalid identifier.`);
  }
  return value;
}

export async function membershipInvite(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  primaryBranchId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("membership_invite", {
    p_org_id: orgId,
    p_user_id: userId,
    // Omit when absent so the RPC's DEFAULT null applies (descriptive branch only).
    ...(primaryBranchId ? { p_primary_branch_id: primaryBranchId } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "membership_invite");
}

export async function membershipActivate(
  supabase: SupabaseClient<Database>,
  membershipId: string,
): Promise<void> {
  const { error } = await supabase.rpc("membership_activate", { p_membership_id: membershipId });
  if (error) throw error;
}

export async function membershipSetCapabilities(
  supabase: SupabaseClient<Database>,
  membershipId: string,
  capabilities: string[],
): Promise<void> {
  const { error } = await supabase.rpc("membership_set_capabilities", {
    p_membership_id: membershipId,
    p_capabilities: capabilities,
  });
  if (error) throw error;
}

export async function membershipRevoke(
  supabase: SupabaseClient<Database>,
  membershipId: string,
): Promise<void> {
  const { error } = await supabase.rpc("membership_revoke", { p_membership_id: membershipId });
  if (error) throw error;
}

export async function membershipSuspend(
  supabase: SupabaseClient<Database>,
  membershipId: string,
): Promise<void> {
  const { error } = await supabase.rpc("membership_suspend", { p_membership_id: membershipId });
  if (error) throw error;
}

export async function branchAssign(
  supabase: SupabaseClient<Database>,
  membershipId: string,
  branchId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("branch_assign", {
    p_membership_id: membershipId,
    p_branch_id: branchId,
  });
  if (error) throw error;
  requireUuid(data, "branch_assign");
}

export async function branchUnassign(
  supabase: SupabaseClient<Database>,
  membershipId: string,
  branchId: string,
): Promise<void> {
  const { error } = await supabase.rpc("branch_unassign", {
    p_membership_id: membershipId,
    p_branch_id: branchId,
  });
  if (error) throw error;
}
