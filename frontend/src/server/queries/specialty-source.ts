import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { loadTradeCatalog } from "@/server/queries/trades";
import type { SpecialtyKind } from "@/server/queries/account-basics";
import type { SpecialtySource } from "@/features/onboarding/basics-fields";

/**
 * The specialty list that suits the account (20261029090002): the Craftsman
 * trades, or the persona activities of public.activities (Engineer), or none.
 */
export async function loadSpecialtySource(kind: SpecialtyKind): Promise<SpecialtySource | null> {
  if (kind === "none") return null;
  if (kind === "trades") return { kind: "trades", keys: (await loadTradeCatalog()).map((t) => t.key) };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activities")
    .select("key")
    .eq("persona_type", kind)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`specialty list read failed (code ${error.code ?? "unknown"})`);
  return { kind: "activities", keys: (data ?? []).map((a) => a.key) };
}
