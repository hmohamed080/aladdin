import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole } from "@/server/queries/platform";
import { loadWorkspaces } from "@/server/queries/workspace";
import { landingFor } from "@/lib/workspace/model";

/**
 * Where an ACTIVE ("active_personal") caller belongs. Landing is DERIVED from the
 * caller's real work contexts and their current selection — never from a role
 * switcher, and never from an account type (PRODUCT_DIRECTION_GUIDE):
 *
 *   1. Platform staff                              → /admin
 *   2. Selected (or only) business workspace       → /b2b
 *   3. Personal workspace                          → /home
 *
 * The two rules that matter for the account model:
 *   * a BUSINESS-ONLY identity — no personal persona, one or more active
 *     memberships — lands in /b2b and is never shown an empty Personal home;
 *   * an identity that has BOTH keeps whichever context it selected, so an
 *     Engineer who also owns a business is no longer trapped in /b2b.
 *
 * Verification state is not consulted anywhere here: it is a trust state, not an
 * access gate.
 */
export async function resolveActiveLanding(
  supabase: SupabaseClient<Database>,
): Promise<"/admin" | "/b2b" | "/home"> {
  const platformRole = await loadPlatformRole(supabase);
  if (platformRole) return "/admin";

  const { context } = await loadWorkspaces(supabase);
  return landingFor(context, false);
}

/** Convenience for route handlers: resolve the active caller's landing path. */
export async function activeLandingPath(): Promise<"/admin" | "/b2b" | "/home"> {
  const supabase = await getServerSupabase();
  return resolveActiveLanding(supabase);
}
