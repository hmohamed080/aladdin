import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type PlatformRole = "support" | "moderator" | "administrator";

/**
 * The caller's platform (staff) role, or null for an ordinary user. Derived from
 * `platform_role_grants`, which every authenticated user may read for THEIR OWN
 * row (RLS `platform_role_grants_select_self`) — a non-staff caller simply reads
 * zero rows. Platform authority NEVER comes from `primary_account_type`; it is
 * only ever this grant (ADR-0007 / PRODUCT_DIRECTION_GUIDE). RLS remains the real
 * boundary on every admin query; this only decides what chrome to render.
 */
export async function loadPlatformRole(
  supabase: SupabaseClient<Database>,
): Promise<PlatformRole | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("platform_role_grants")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data.role as PlatformRole;
}

/** True when the caller may open the Admin surface (any staff role). */
export function isPlatformStaff(role: PlatformRole | null): boolean {
  return role !== null;
}

/**
 * True when the caller may take verification review actions. The trusted
 * `review_*` RPCs gate on `is_platform('support')`, i.e. ANY staff role, so the
 * UI mirrors that exactly — the RPC is still the enforcing boundary.
 */
export function canReview(role: PlatformRole | null): boolean {
  return role !== null;
}
