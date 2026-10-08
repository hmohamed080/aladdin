"use server";

import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { DASHBOARD_OPPORTUNITY_COUNT, dashboardModeFor, type DashboardDateOrder, type DashboardSort } from "@/lib/installer/dashboard-opportunities";
import { toOpportunityVMs } from "@/features/home/installer-dashboard-data";
import type { InstallerOpportunityVM } from "@/features/installer-dashboard-preview/view-model";
import { listDashboardOpportunities } from "@/server/queries/job-opportunities";

/**
 * The installer dashboard's opportunity strip, for one of its quick filters — "Near me", "Matching my skills",
 * "Newest" (or Oldest).
 *
 * The browser names a quick filter; the SERVER maps it to one of four fixed orderings of the same paging function the
 * Jobs board reads (`listDashboardOpportunities`), so there is no query, column or order the caller can supply. Near me
 * is LOCATION only (same city, primary governorate, another declared service area — no GPS, no distance); Best match is
 * TRADE + SPECIALTY only. The cards display the canonical Overall Match the database computed for the signed-in caller.
 * Neither ordering narrows what is listed: a low or zero match, or a job in another governorate, is still discoverable
 * and still applicable — they only order it. Everything is scoped by the caller's session.
 */
export type LoadDashboardOpportunitiesResult = { ok: true; opportunities: InstallerOpportunityVM[] } | { ok: false };

const SORTS: readonly DashboardSort[] = ["match", "distance", "recent"];
const DATE_ORDERS: readonly DashboardDateOrder[] = ["newest", "oldest"];

export async function loadDashboardOpportunitiesAction(sort: string, dateOrder: string): Promise<LoadDashboardOpportunitiesResult> {
  if (!SORTS.includes(sort as DashboardSort) || !DATE_ORDERS.includes(dateOrder as DashboardDateOrder)) return { ok: false };
  try {
    const store = await cookies();
    const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
    const supabase = await getServerSupabase();
    const rows = await listDashboardOpportunities(supabase, dashboardModeFor(sort as DashboardSort, dateOrder as DashboardDateOrder), DASHBOARD_OPPORTUNITY_COUNT);
    return { ok: true, opportunities: toOpportunityVMs(rows, createTranslator(locale), locale) };
  } catch {
    return { ok: false };
  }
}
