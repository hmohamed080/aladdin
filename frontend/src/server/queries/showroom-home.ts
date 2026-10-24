import "server-only";
import { cache } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CatalogRow } from "@/server/queries/commerce";
import { parseShowroomHomeMetrics, type ShowroomHomeMetrics } from "@/features/showroom-shell/home/metrics";

type DB = SupabaseClient<Database>;

/**
 * Read models for the showroom suite Home. Every read runs through the caller's
 * own client: RLS, the org guard inside the RPC and the explicit organization
 * filters below all apply, and nothing here uses a service-role client.
 */

/**
 * Directional KPI aggregates for one organization over one period — a single
 * round trip to `showroom_home_metrics` (20261007090002). `from`/`to` are the
 * inclusive `yyyy-mm-dd` window the Home resolved, `timezone` the organization's
 * own calendar, so every period-dependent card shares one range.
 */
export async function loadShowroomHomeMetrics(
  supabase: DB,
  orgId: string,
  range: { from: string; to: string },
  timezone: string,
): Promise<ShowroomHomeMetrics> {
  const { data, error } = await supabase.rpc("showroom_home_metrics", {
    p_org_id: orgId,
    p_from: range.from,
    p_to: range.to,
    p_timezone: timezone,
  });
  if (error) throw error;
  return parseShowroomHomeMetrics(data);
}

export type ShowroomKpiLayout = {
  /** The saved order as stored, or null when neither a personal nor a team row exists. */
  saved: string[] | null;
  hasPersonal: boolean;
  hasTeamDefault: boolean;
};

/**
 * The effective showroom-suite KPI layout: the caller's personal row, else the
 * organization's team default, else null (the catalog's system default applies).
 * Reads ONLY the `showroom_suite` surface — production Home's layouts are a
 * different surface and never mix with these.
 */
export async function loadShowroomKpiLayout(
  supabase: DB,
  orgId: string,
  membershipId: string,
): Promise<ShowroomKpiLayout> {
  const [personal, team] = await Promise.all([
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .eq("membership_id", membershipId)
      .eq("surface", "showroom_suite")
      .maybeSingle(),
    supabase
      .from("dashboard_kpi_layouts")
      .select("card_order")
      .eq("organization_id", orgId)
      .is("membership_id", null)
      .eq("surface", "showroom_suite")
      .maybeSingle(),
  ]);
  if (personal.error) throw personal.error;
  if (team.error) throw team.error;
  return {
    saved: personal.data?.card_order ?? team.data?.card_order ?? null,
    hasPersonal: personal.data !== null,
    hasTeamDefault: team.data !== null,
  };
}

export type RecommendedProduct = Pick<
  CatalogRow,
  "id" | "name" | "brand" | "supplier_name" | "supplier_verified" | "unit" | "category"
> & { id: string; name: string };

export const RECOMMENDED_PRODUCT_LIMIT = 4;

/**
 * "منتجات مقترحة لك" — a small, DETERMINISTIC sample, not a recommendation
 * engine: the most recently published products from OTHER organizations (a
 * showroom is shown what it could buy, never its own listings), newest first
 * with the product id as the tie-break so equal timestamps never reorder. The
 * published-products view is already RLS-scoped. The full browsable catalog is
 * a later phase; this is only enough real data for the Home section.
 */
export async function loadRecommendedProducts(
  supabase: DB,
  orgId: string,
  limit = RECOMMENDED_PRODUCT_LIMIT,
): Promise<RecommendedProduct[]> {
  const { data, error } = await supabase
    .rpc("catalog_products", { p_org_id: orgId })
    // Every column named in order() must also be selected: PostgREST orders a function result by
    // the PROJECTED columns, so ordering by an unselected one fails the whole query
    // ("column record.published_at does not exist") and takes the Home body down with it.
    .select("id, name, brand, supplier_name, supplier_verified, unit, category, published_at")
    .neq("organization_id", orgId)
    .order("published_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<Pick<CatalogRow, "id" | "name" | "brand" | "supplier_name" | "supplier_verified" | "unit" | "category">>).filter(
    (row): row is RecommendedProduct => !!row.id && !!row.name,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Home V2 sections. Same rules as above: the caller's own client, RLS-bound, organization filter stated
// explicitly, no service role, nothing fabricated - an empty result is an empty result.
// ---------------------------------------------------------------------------------------------------------------

export type { ShowroomOrderCounts } from "@/features/showroom-shell/home/metrics";

/**
 * Two order figures `showroom_home_metrics` does not carry, counted from the same RLS-scoped `order_list` view.
 *  - completedOrders: orders this organization PLACED that reached `completed` inside the window.
 *  - awaitingExecution: orders it placed that are `confirmed` and not yet started (right now - no window).
 */
export async function loadShowroomOrderCounts(
  supabase: DB,
  orgId: string,
  window: { start: string; end: string },
): Promise<{ completedOrders: number; awaitingExecution: number }> {
  const [done, waiting] = await Promise.all([
    supabase
      .from("order_list")
      .select("id", { count: "exact", head: true })
      .eq("requester_org_id", orgId)
      .eq("status", "completed")
      .gte("completed_at", window.start)
      .lt("completed_at", window.end),
    countAwaitingExecution(supabase, orgId),
  ]);
  if (done.error) throw done.error;
  return { completedOrders: done.count ?? 0, awaitingExecution: waiting };
}

/**
 * "Confirmed, not started" does not depend on the window, and the home page asks for
 * the current and the previous window in the same render: count it once per render.
 * (Node's fetch memoization happened to merge the two; the Workers build does not.)
 */
const countAwaitingExecution = cache(async function countAwaitingExecution(supabase: DB, orgId: string): Promise<number> {
  const { count, error } = await supabase.from("order_list").select("id", { count: "exact", head: true }).eq("requester_org_id", orgId).eq("status", "confirmed");
  if (error) throw error;
  return count ?? 0;
});

export type IncomingQuotation = {
  id: string;
  supplierName: string;
  rfqTitle: string;
  status: string;
  total: number | null;
  itemCount: number;
  submittedAt: string | null;
  validityDate: string | null;
  /** The product of the quotation's first line, when it came from a catalog product - used only for the thumbnail. */
  productId: string | null;
};

/** Quotations answering THIS organization's Direct RFQs, newest first. Drafts are the supplier's private work and never listed. */
export async function loadLatestIncomingQuotations(supabase: DB, orgId: string, limit = 5): Promise<IncomingQuotation[]> {
  const { data, error } = await supabase
    .from("quotation_list")
    .select("id, supplier_name, rfq_title, status, total, item_count, submitted_at, validity_date, created_at")
    .eq("requester_org_id", orgId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const ids = (data ?? []).flatMap((q) => (q.id ? [q.id] : []));
  const productByQuotation = await firstProductPerQuotation(supabase, ids);
  return (data ?? []).flatMap((q) =>
    q.id && q.status
      ? [{ id: q.id, supplierName: q.supplier_name ?? "", rfqTitle: q.rfq_title ?? "", status: q.status, total: q.total === null ? null : Number(q.total), itemCount: Number(q.item_count ?? 0), submittedAt: q.submitted_at, validityDate: q.validity_date, productId: productByQuotation.get(q.id) ?? null }]
      : [],
  );
}

/** quotation id -> product of its first line (quotation line -> RFQ line -> product). Both reads are RLS-scoped. */
async function firstProductPerQuotation(supabase: DB, quotationIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (quotationIds.length === 0) return out;
  const { data: lines, error } = await supabase
    .from("quotation_items")
    .select("quotation_id, rfq_item_id, created_at")
    .in("quotation_id", [...quotationIds])
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rfqItemIds = [...new Set((lines ?? []).flatMap((l) => (l.rfq_item_id ? [l.rfq_item_id] : [])))];
  if (rfqItemIds.length === 0) return out;
  const { data: items, error: itemsError } = await supabase.from("rfq_items").select("id, product_id").in("id", rfqItemIds);
  if (itemsError) throw itemsError;
  const productOf = new Map((items ?? []).flatMap((i) => (i.product_id ? [[i.id, i.product_id] as const] : [])));
  for (const line of lines ?? []) {
    const product = line.rfq_item_id ? productOf.get(line.rfq_item_id) : undefined;
    if (product && !out.has(line.quotation_id)) out.set(line.quotation_id, product);
  }
  return out;
}

export type CategorySpend = { category: string; amount: number };

/**
 * Where this organization's committed purchasing went, by product category, for orders CONFIRMED in the
 * period and not cancelled (the same basis as the Total purchases figure). Each order line is attributed
 * through the quotation line it came from (`order_category_spend`); a line whose product is no longer in the
 * catalog is reported as `other` rather than dropped, so the parts still sum to the order lines' total.
 */
export async function loadPurchasingByCategory(supabase: DB, orgId: string, window: { start: string; end: string }): Promise<CategorySpend[]> {
  const { data, error } = await supabase
    .from("order_category_spend")
    .select("category, amount")
    .eq("requester_org_id", orgId)
    .neq("status", "cancelled")
    .gte("confirmed_at", window.start)
    .lt("confirmed_at", window.end);
  if (error) throw error;
  const sums = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.category) continue;
    sums.set(row.category, (sums.get(row.category) ?? 0) + Number(row.amount ?? 0));
  }
  return [...sums.entries()].map(([category, amount]) => ({ category, amount })).filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
}
