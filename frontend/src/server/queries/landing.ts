import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole } from "@/server/queries/platform";

/**
 * Where an ACTIVE ("active_personal") caller belongs. Landing is DERIVED — never
 * a role switcher (PRODUCT_DIRECTION_GUIDE):
 *
 *   1. Platform staff        → /admin   (platform operations)
 *   2. Has an active org      → /b2b     (capability-scoped workspace)
 *   3. Otherwise (consumer /  → /home    (non-B2B destination; NEVER the Sales
 *      org-less professional)             cockpit)
 *
 * A consumer must never land in the B2B workspace, so the fall-through target is
 * the consumer/individual home, not /b2b.
 */
export async function resolveActiveLanding(
  supabase: SupabaseClient<Database>,
): Promise<"/admin" | "/b2b" | "/home"> {
  const platformRole = await loadPlatformRole(supabase);
  if (platformRole) return "/admin";

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/home";

  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return membership ? "/b2b" : "/home";
}

/** Convenience for route handlers: resolve the active caller's landing path. */
export async function activeLandingPath(): Promise<"/admin" | "/b2b" | "/home"> {
  const supabase = await getServerSupabase();
  return resolveActiveLanding(supabase);
}
