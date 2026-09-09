import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { SYSTEM_DEFAULT_KPI_ORDER, type DashboardKpiCardKey } from "@/lib/workspace/dashboard-kpi-catalog";

type DB = SupabaseClient<Database>;

export type EffectiveKpiLayout = {
  cardOrder: DashboardKpiCardKey[];
  /** Whether THIS caller has their own personal override (vs. inheriting the team default or system default) — the dialog needs this to offer "reset to team default" only when there is something to reset. */
  hasPersonal: boolean;
  /** Whether the organization has ever set a team default — the dialog needs this to offer "reset to system default" only when there is something to reset. */
  hasTeamDefault: boolean;
};

/**
 * Resolves the caller's effective KPI layout: their own personal row, else
 * the organization's team default, else the application's hardcoded system
 * order — never duplicated here, imported from the one shared catalog.
 *
 * Two narrow reads in parallel rather than one `.or(...)` filter: building
 * an `or` string from a caller-scoped membership id works, but two plain
 * `.eq()`/`.is()` reads are simpler to read and no slower for a two-row table.
 */
export async function loadEffectiveKpiLayout(
  supabase: DB,
  orgId: string,
  membershipId: string,
): Promise<EffectiveKpiLayout> {
  const [personal, team] = await Promise.all([
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .eq("membership_id", membershipId)
      .maybeSingle(),
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .is("membership_id", null)
      .maybeSingle(),
  ]);
  if (personal.error) throw personal.error;
  if (team.error) throw team.error;

  const cardOrder = (personal.data?.card_order ?? team.data?.card_order ?? SYSTEM_DEFAULT_KPI_ORDER) as DashboardKpiCardKey[];
  return {
    cardOrder,
    hasPersonal: personal.data !== null,
    hasTeamDefault: team.data !== null,
  };
}
