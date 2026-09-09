"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import type { DashboardKpiCardKey } from "@/lib/workspace/dashboard-kpi-catalog";

/**
 * Thin Server Actions over the four `dashboard_kpi_layout_*` RPCs
 * (20260915090001) — no authorization decision made here, the RPCs decide
 * (an ordinary member calling the team-default actions is rejected there).
 * Plain `{ok}` returns rather than the `FormState`/`useActionState` shape
 * `organization-i18n.ts` uses: the customization dialog drives these from
 * its own interactive reorder/show-hide state, not a per-field form.
 */
export type KpiLayoutActionResult = { ok: true } | { ok: false; message: string };

export async function setPersonalKpiLayoutAction(
  orgId: string,
  cardOrder: DashboardKpiCardKey[],
): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_set_personal", {
    p_org_id: orgId,
    p_card_order: cardOrder,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/b2b");
  return { ok: true };
}

export async function resetPersonalKpiLayoutAction(orgId: string): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_reset_personal", { p_org_id: orgId });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/b2b");
  return { ok: true };
}

export async function setTeamDefaultKpiLayoutAction(
  orgId: string,
  cardOrder: DashboardKpiCardKey[],
): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_set_team_default", {
    p_org_id: orgId,
    p_card_order: cardOrder,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/b2b");
  return { ok: true };
}

export async function resetTeamDefaultKpiLayoutAction(orgId: string): Promise<KpiLayoutActionResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("dashboard_kpi_layout_reset_team_default", { p_org_id: orgId });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/b2b");
  return { ok: true };
}
