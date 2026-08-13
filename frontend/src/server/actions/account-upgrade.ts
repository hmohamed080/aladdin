import "server-only";

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

type PersonaType = Database["public"]["Enums"]["persona_type"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, rpcName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${rpcName} returned an invalid identifier.`);
  }
  return value;
}

/** Self-service: the signed-in user requests a professional account upgrade. */
export async function requestAccountUpgrade(
  supabase: SupabaseClient<Database>,
  requestedAccountType: PersonaType,
): Promise<string> {
  const { data, error } = await supabase.rpc("request_account_upgrade", {
    p_requested_account_type: requestedAccountType,
  });
  if (error) throw error;
  return requireUuid(data, "request_account_upgrade");
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

export async function reviewRequestChanges(
  supabase: SupabaseClient<Database>,
  verificationId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("review_request_changes", {
    p_verification_id: verificationId,
    p_reason: reason,
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

export async function setProfileHidden(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc("set_profile_hidden", { p_user_id: userId });
  if (error) throw error;
}
