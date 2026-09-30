import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { parseAdminAccess } from "@/lib/permissions/admin";

/**
 * Whether the caller is Admin Staff (holds any active platform role).
 *
 * Resolved through `admin_my_access()` — i.e. `admin_role_assignments`, the
 * single source of platform authority (Admin Core 1A). This deliberately does
 * NOT read `platform_role_grants`: that table is a write-only compatibility
 * bridge and is never an authorization input (docs/admin/ADMIN_RBAC_ARCHITECTURE.md
 * §6). Platform authority never comes from `primary_account_type` either.
 *
 * Takes the caller's client (rather than using `loadAdminAccess`) so landing
 * resolution stays a plain function of the client it is given. RLS and the RPC
 * guards remain the real boundary; this decides routing and chrome only.
 */
export async function loadIsAdminStaff(supabase: SupabaseClient<Database>): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("admin_my_access");
  if (error) return false;
  return parseAdminAccess(data).isStaff;
}
