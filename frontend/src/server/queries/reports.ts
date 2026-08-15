import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read models for Reports & Analytics.
 *
 * Everything here is an aggregate of records the caller can already see: the same
 * RLS-scoped views that fill the module lists, counted. That is a deliberate
 * constraint, not a limitation — a report that shows a number the user cannot
 * click through to and verify is a number nobody should act on. There are no
 * targets, forecasts, growth percentages or benchmarks, because no model in the
 * database produces them, and inventing them would put fiction in front of a
 * client.
 */
type DB = SupabaseClient<Database>;

export type PurchaseSummary = {
  requests: Record<string, number>;
  offers: Record<string, number>;
  orders: Record<string, number>;
  orderValue: number;
  acceptedOfferValue: number;
  /** Who this organization actually buys from, by value. Derived from the same
   *  order read as the totals above rather than a second pass over it. */
  topSuppliers: { name: string; orders: number; value: number }[];
};

export type SellSummary = {
  quotesSent: Record<string, number>;
  ordersReceived: number;
  ordersReceivedValue: number;
};

function tally(rows: { status: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.status) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/**
 * What this organization spends and where it is in the buying chain.
 *
 * Every figure on the buying side of the report comes from these three reads. The
 * supplier ranking is folded in here deliberately: it is an aggregate of the SAME
 * orders as the totals, and asking the database for that set twice in one page
 * render is pure waste. Each read selects only the columns the aggregates need.
 */
export async function purchaseSummary(supabase: DB, orgId: string): Promise<PurchaseSummary> {
  const [rfqs, quotes, orders] = await Promise.all([
    supabase.from("rfq_list").select("status").eq("requester_org_id", orgId),
    supabase.from("quotation_list").select("status, total").eq("requester_org_id", orgId),
    supabase.from("order_list").select("status, total, supplier_name").eq("requester_org_id", orgId),
  ]);
  if (rfqs.error) throw rfqs.error;
  if (quotes.error) throw quotes.error;
  if (orders.error) throw orders.error;

  const orderRows = orders.data ?? [];
  const quoteRows = quotes.data ?? [];

  const byName = new Map<string, { orders: number; value: number }>();
  for (const r of orderRows) {
    const name = r.supplier_name ?? "—";
    const cur = byName.get(name) ?? { orders: 0, value: 0 };
    cur.orders += 1;
    cur.value += Number(r.total ?? 0);
    byName.set(name, cur);
  }

  return {
    requests: tally(rfqs.data ?? []),
    offers: tally(quoteRows),
    orders: tally(orderRows),
    orderValue: orderRows.reduce((s, o) => s + Number(o.total ?? 0), 0),
    acceptedOfferValue: quoteRows
      .filter((q) => q.status === "accepted")
      .reduce((s, q) => s + Number(q.total ?? 0), 0),
    topSuppliers: [...byName.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
}

/** What this organization sells, for a showroom that also supplies. */
export async function sellSummary(supabase: DB, orgId: string): Promise<SellSummary> {
  const [quotes, orders] = await Promise.all([
    supabase.from("quotation_list").select("status").eq("supplier_org_id", orgId),
    supabase.from("order_list").select("total").eq("supplier_org_id", orgId),
  ]);
  if (quotes.error) throw quotes.error;
  if (orders.error) throw orders.error;

  const orderRows = orders.data ?? [];
  return {
    quotesSent: tally(quotes.data ?? []),
    ordersReceived: orderRows.length,
    ordersReceivedValue: orderRows.reduce((s, o) => s + Number(o.total ?? 0), 0),
  };
}

/** How the shortlist splits across the sector taxonomy. */
export async function savedByCategory(supabase: DB, orgId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("saved_product_list")
    .select("category")
    .eq("organization_id", orgId);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data ?? []) if (r.category) out[r.category] = (out[r.category] ?? 0) + 1;
  return out;
}

