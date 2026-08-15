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
 *
 * Filters are applied IN THE DATABASE, not to a fetched array. A date range that
 * narrowed the chart but not the totals would be worse than no filter at all, so
 * every aggregate on the page takes the same `ReportFilters` and each read
 * applies whichever parts of it that relation can honour — documented per query
 * below where a relation cannot honour one.
 */
type DB = SupabaseClient<Database>;

export type ProductCategory = Database["public"]["Enums"]["product_category"];

export type ReportFilters = {
  /** Inclusive ISO date (yyyy-mm-dd). */
  from?: string;
  /** Inclusive ISO date; expanded to the end of that day when applied. */
  to?: string;
  branchId?: string;
  category?: ProductCategory;
};

/** `to` names a DAY, and a timestamp at 09:00 on that day must be inside it. */
function endOfDay(iso: string) {
  return `${iso}T23:59:59.999Z`;
}

export type TrendBucket = { month: string; value: number };

export type PurchaseSummary = {
  requests: Record<string, number>;
  offers: Record<string, number>;
  orders: Record<string, number>;
  orderValue: number;
  acceptedOfferValue: number;
  /** Who this organization actually buys from, by value. Derived from the same
   *  order read as the totals above rather than a second pass over it. */
  topDistributors: { name: string; orders: number; value: number }[];
  /** Committed order value per calendar month, oldest first. */
  trend: TrendBucket[];
};

export type SellSummary = {
  quotesSent: Record<string, number>;
  ordersReceived: number;
  ordersReceivedValue: number;
};

export type ProjectSummary = {
  /** Projects this organization delivers, by status. */
  executing: Record<string, number>;
  /** Projects delivered FOR this organization, by status. */
  incoming: Record<string, number>;
  executingValue: number;
};

function tally(rows: { status: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.status) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/**
 * Group order value into calendar months.
 *
 * The bucket set is built from the RANGE, not from the rows, so a month in which
 * the business bought nothing renders as a gap in the line instead of silently
 * collapsing — "we spent nothing in March" is exactly the sort of thing a
 * purchasing manager needs the chart to say.
 */
function monthlyTrend(
  rows: { confirmed_at: string | null; total: number | string | null }[],
  months: number,
): TrendBucket[] {
  const buckets = new Map<string, number>();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.set(d.toISOString().slice(0, 7), 0);
  }
  for (const r of rows) {
    if (!r.confirmed_at) continue;
    const key = r.confirmed_at.slice(0, 7);
    // Anything older than the window is simply outside the chart's range.
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + Number(r.total ?? 0));
  }
  return [...buckets.entries()].map(([month, value]) => ({ month, value }));
}

/**
 * What this organization spends and where it sits in the buying chain.
 *
 * Every figure on the buying side of the report comes from these three reads. The
 * distributor ranking and the trend are folded in here deliberately: both are
 * aggregates of the SAME orders as the totals, and asking the database for that
 * set three times in one page render is pure waste. Each read selects only the
 * columns the aggregates need.
 *
 * The category filter narrows to orders that contain a line in that category, and
 * is resolved through `order_category_spend` — the projection that knows how an
 * order line maps back to a product.
 */
export async function purchaseSummary(
  supabase: DB,
  orgId: string,
  f: ReportFilters = {},
  trendMonths = 6,
): Promise<PurchaseSummary> {
  const categoryOrderIds = await orderIdsInCategory(supabase, orgId, "requester_org_id", f.category);

  let rfqQ = supabase.from("rfq_list").select("status").eq("requester_org_id", orgId);
  let quoteQ = supabase.from("quotation_list").select("status, total, submitted_at").eq("requester_org_id", orgId);
  let orderQ = supabase
    .from("order_list")
    .select("status, total, supplier_name, confirmed_at")
    .eq("requester_org_id", orgId);

  if (f.from) {
    rfqQ = rfqQ.gte("created_at", f.from);
    quoteQ = quoteQ.gte("created_at", f.from);
    orderQ = orderQ.gte("confirmed_at", f.from);
  }
  if (f.to) {
    rfqQ = rfqQ.lte("created_at", endOfDay(f.to));
    quoteQ = quoteQ.lte("created_at", endOfDay(f.to));
    orderQ = orderQ.lte("confirmed_at", endOfDay(f.to));
  }
  // Quotations have no branch of their own — an offer belongs to the request it
  // answers — so a branch filter narrows requests and orders, and the offers
  // panel says so in the UI rather than pretending to be scoped.
  if (f.branchId) {
    rfqQ = rfqQ.eq("requester_branch_id", f.branchId);
    orderQ = orderQ.eq("requester_branch_id", f.branchId);
  }
  if (categoryOrderIds) orderQ = orderQ.in("id", categoryOrderIds);

  const [rfqs, quotes, orders] = await Promise.all([rfqQ, quoteQ, orderQ]);
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
    topDistributors: [...byName.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    trend: monthlyTrend(orderRows, trendMonths),
  };
}

/**
 * The order ids that contain at least one line in `category`, or `null` when no
 * category filter is active (so callers can skip the `.in()` entirely rather
 * than pass an unbounded list).
 */
async function orderIdsInCategory(
  supabase: DB,
  orgId: string,
  side: "requester_org_id" | "supplier_org_id",
  category?: ProductCategory,
): Promise<string[] | null> {
  if (!category) return null;
  const { data, error } = await supabase
    .from("order_category_spend")
    .select("order_id")
    .eq(side, orgId)
    .eq("category", category);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.order_id).filter((id): id is string => !!id))];
}

/**
 * Where the money went, by sector category.
 *
 * Reads the `order_category_spend` projection, which resolves an order line back
 * to its product through the quotation it came from — the only honest link,
 * since an order line is a frozen snapshot that carries no product id.
 */
export async function spendByCategory(
  supabase: DB,
  orgId: string,
  f: ReportFilters = {},
): Promise<Record<string, number>> {
  let q = supabase
    .from("order_category_spend")
    .select("category, amount")
    .eq("requester_org_id", orgId);
  if (f.from) q = q.gte("confirmed_at", f.from);
  if (f.to) q = q.lte("confirmed_at", endOfDay(f.to));
  if (f.branchId) q = q.eq("requester_branch_id", f.branchId);
  if (f.category) q = q.eq("category", f.category);

  const { data, error } = await q;
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    if (r.category) out[r.category] = (out[r.category] ?? 0) + Number(r.amount ?? 0);
  }
  return out;
}

/** What this organization sells, for a showroom that also supplies. */
export async function sellSummary(supabase: DB, orgId: string, f: ReportFilters = {}): Promise<SellSummary> {
  let quoteQ = supabase.from("quotation_list").select("status").eq("supplier_org_id", orgId);
  let orderQ = supabase.from("order_list").select("total").eq("supplier_org_id", orgId);
  if (f.from) {
    quoteQ = quoteQ.gte("created_at", f.from);
    orderQ = orderQ.gte("confirmed_at", f.from);
  }
  if (f.to) {
    quoteQ = quoteQ.lte("created_at", endOfDay(f.to));
    orderQ = orderQ.lte("confirmed_at", endOfDay(f.to));
  }

  const [quotes, orders] = await Promise.all([quoteQ, orderQ]);
  if (quotes.error) throw quotes.error;
  if (orders.error) throw orders.error;

  const orderRows = orders.data ?? [];
  return {
    quotesSent: tally(quotes.data ?? []),
    ordersReceived: orderRows.length,
    ordersReceivedValue: orderRows.reduce((s, o) => s + Number(o.total ?? 0), 0),
  };
}

/**
 * Delivery work on both sides of the business, by status.
 *
 * One read, split here: a project row already names both parties, so asking the
 * database twice for "mine to deliver" and "delivered for me" would be two trips
 * for one set of rows.
 */
export async function projectSummary(supabase: DB, orgId: string, f: ReportFilters = {}): Promise<ProjectSummary> {
  let q = supabase
    .from("project_list")
    .select("status, requester_org_id, executing_org_id, order_total")
    .or(`requester_org_id.eq.${orgId},executing_org_id.eq.${orgId}`);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", endOfDay(f.to));
  if (f.branchId) q = q.eq("branch_id", f.branchId);

  const { data, error } = await q;
  if (error) throw error;

  const executing: Record<string, number> = {};
  const incoming: Record<string, number> = {};
  let executingValue = 0;
  for (const r of data ?? []) {
    if (!r.status) continue;
    if (r.executing_org_id === orgId) {
      executing[r.status] = (executing[r.status] ?? 0) + 1;
      executingValue += Number(r.order_total ?? 0);
    } else {
      incoming[r.status] = (incoming[r.status] ?? 0) + 1;
    }
  }
  return { executing, incoming, executingValue };
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

/**
 * The showroom's own sales pipeline, for the team-analytics panel.
 *
 * Only ever called when the caller holds a sales capability — the page must not
 * ask the database questions the reader is not entitled to the answer to, even
 * though RLS would return nothing anyway.
 */
export async function salesSummary(
  supabase: DB,
  orgId: string,
  f: ReportFilters = {},
): Promise<{ leadsByStage: Record<string, number>; won: number; lost: number; customers: number }> {
  let leadQ = supabase.from("leads").select("stage, status").eq("organization_id", orgId);
  let custQ = supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "active");
  if (f.from) leadQ = leadQ.gte("created_at", f.from);
  if (f.to) leadQ = leadQ.lte("created_at", endOfDay(f.to));
  if (f.branchId) {
    leadQ = leadQ.eq("branch_id", f.branchId);
    custQ = custQ.eq("branch_id", f.branchId);
  }

  const [leads, customers] = await Promise.all([leadQ, custQ]);
  if (leads.error) throw leads.error;
  if (customers.error) throw customers.error;

  const leadsByStage: Record<string, number> = {};
  let won = 0;
  let lost = 0;
  for (const l of leads.data ?? []) {
    if (l.status === "won") won += 1;
    else if (l.status === "lost") lost += 1;
    else if (l.stage) leadsByStage[l.stage] = (leadsByStage[l.stage] ?? 0) + 1;
  }
  return { leadsByStage, won, lost, customers: customers.count ?? 0 };
}
