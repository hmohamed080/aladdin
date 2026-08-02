import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Tenant-context queries (Phase 1 foundation).
 *
 * Organization access is DERIVED from the caller's active memberships — never
 * from a global role on the profile (ADR-0007, PRODUCT_DIRECTION_GUIDE). These
 * helpers read RLS-protected tables through a caller-scoped client
 * ({@link createServerSupabaseClient}), so the database itself guarantees a
 * caller only ever sees their own membership rows. There is no service-role or
 * client-supplied `organization_id` involved.
 *
 * These are the minimal patterns proving authenticated tenant-aware access; the
 * membership-management feature builds richer queries on top.
 */

type Membership = Database["public"]["Tables"]["memberships"]["Row"];

/** Active memberships for the current caller (RLS scopes this to their own rows). */
export async function getMyActiveMemberships(
  supabase: SupabaseClient<Database>,
): Promise<Pick<Membership, "id" | "organization_id" | "branch_id" | "status">[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, organization_id, branch_id, status")
    .eq("status", "active");
  if (error) throw error;
  return data ?? [];
}

/** Organization ids the caller can currently act within. */
export async function getMyOrganizationIds(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const memberships = await getMyActiveMemberships(supabase);
  return [...new Set(memberships.map((m) => m.organization_id))];
}
