import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Trusted account-upgrade & verification workflow boundaries (Sprint 2).
 *
 * These are thin wrappers over the server-side RPCs. All authorization,
 * transactionality, idempotency, and audit emission live in the database
 * functions (ADR-0007) — the client only forwards the CALLER's JWT via a
 * caller-scoped server client ({@link createServerSupabaseClient}), so the
 * database enforces who may do what. No privileged logic runs here, and the
 * service-role key is never used. `primary_account_type` and
 * `public_profile_status` are never written directly from the client.
 */

type AccountType = Database["public"]["Enums"]["account_type"];

/** Self-service: the signed-in user requests a professional account upgrade. */
export async function requestAccountUpgrade(
  supabase: SupabaseClient<Database>,
  requestedAccountType: AccountType,
): Promise<string> {
  const { data, error } = await supabase.rpc("request_account_upgrade", {
    p_requested_account_type: requestedAccountType,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Platform-reviewer operations. Each RPC rejects a caller without platform
 * authority server-side; these wrappers simply carry the reviewer's own JWT.
 */
export async function reviewStart(
  supabase: SupabaseClient<Database>,
  verificationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("review_start", { p_verification_id: verificationId });
  if (error) throw error;
}

export async function reviewApprove(
  supabase: SupabaseClient<Database>,
  verificationId: string,
  grantPublicListing = true,
): Promise<void> {
  const { error } = await supabase.rpc("review_approve", {
    p_verification_id: verificationId,
    p_grant_public_listing: grantPublicListing,
  });
  if (error) throw error;
}

export async function applyAccountUpgrade(
  supabase: SupabaseClient<Database>,
  verificationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("apply_account_upgrade", {
    p_verification_id: verificationId,
  });
  if (error) throw error;
}

export async function reviewReject(
  supabase: SupabaseClient<Database>,
  verificationId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("review_reject", {
    p_verification_id: verificationId,
    p_reason: reason,
  });
  if (error) throw error;
}
