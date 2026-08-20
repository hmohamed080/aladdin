import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { batches } from "@/server/queries/commerce";

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

/**
 * The supply side of the very same chain — what a Distributor, Manufacturer or
 * Importer sees looking the other way down it.
 *
 * WHY THIS IS NOT `PurchaseSummary` WITH THE COLUMNS SWAPPED
 * The seats are not symmetrical, because the two parties do different work:
 *
 *   - A buyer's RFQ tally answers "what have I asked for". A SELLER's answers
 *     "what has been asked OF me", and the status that matters is `submitted` —
 *     a request nobody has priced yet. That is the seller's one genuinely
 *     time-critical number and it has no counterpart on the buying side, where
 *     `submitted` merely means "sent, waiting".
 *   - A buyer's `topDistributors` ranks who it spends with. A seller's
 *     `topCustomers` ranks who spends with IT — same shape, opposite direction,
 *     and derived from the same single order read.
 *   - `topProducts` exists only here. A buyer's spend splits by CATEGORY (it
 *     buys across a sector); a seller's revenue splits by ITS OWN PRODUCTS, and
 *     "which of my lines actually sell" is the question the catalog module is
 *     downstream of.
 *
 * Reads: three list views plus, only when there are orders to explain, one pass
 * over their line items. Every one is RLS-scoped, so a caller sees exactly the
 * records it could open by hand.
 */
/**
 * The flow figures for ONE window of time. Counted, never estimated.
 *
 * Each field names the timestamp it is measured on, because they are not the
 * same one: a request and a quotation are dated by when the record came into
 * existence, an order by when it was CONFIRMED. Confirmation is the moment the
 * money became real, and dating won business by `created_at` would credit a
 * deal to the month it was drafted rather than the month it closed.
 */
export type PeriodStats = {
  /** Requests received in the window, by `rfqs.created_at`. */
  demand: number;
  /** Quotations sent in the window, by `quotations.created_at`. */
  quotations: number;
  /** Orders confirmed in the window, by `orders.confirmed_at`. */
  orders: number;
  /** Value of those orders. */
  orderValue: number;
};

/**
 * A window and the equally-long window immediately before it.
 *
 * `previous` is what makes a delta legitimate, and the consumer must check it:
 * a zero baseline has no percentage, and the UI is required to fall back rather
 * than print ∞, 100% or "new". See `KpiDelta`.
 */
export type PeriodComparison = {
  days: number;
  current: PeriodStats;
  previous: PeriodStats;
};

export type SupplySummary = {
  /** Requests addressed to this organization, by status. */
  demand: Record<string, number>;
  /** Requests submitted and not yet answered — the seller's work queue. */
  awaitingResponse: number;
  /** Quotations this organization has sent, by status. */
  quotations: Record<string, number>;
  /** Sent, undecided — value is committed here but not yet won. */
  awaitingDecision: number;
  awaitingDecisionValue: number;
  acceptedValue: number;
  /** Orders this organization must fulfil, by status. */
  orders: Record<string, number>;
  orderValue: number;
  /** Distinct organizations that have placed an order with this one. */
  activeCustomers: number;
  /** Who buys from this organization, by value. */
  topCustomers: { name: string; orders: number; value: number }[];
  /** This organization's own products, ranked by ordered value. */
  topProducts: { name: string; quantity: number; value: number }[];
  /** Order value won per calendar month, oldest first. */
  trend: TrendBucket[];
  /**
   * Present only when a `compareDays` window was asked for. Computed from the
   * SAME rows as everything above — no extra round trip buys this.
   */
  period?: PeriodComparison;
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
 * Split three already-fetched row sets into a window and the window before it.
 *
 * WHY THIS IS DONE IN MEMORY AND NOT IN THE DATABASE
 * The honest objection to a period-over-period delta was never that the data
 * could not support one — it was that asking for it would double the page's
 * reads, and a comparison that costs six extra round trips on every dashboard
 * render is a comparison that should not exist. But the dashboard ALREADY pulls
 * every one of this organization's requests, quotations and orders in order to
 * tally them by status. Two windows over rows that are in hand is arithmetic,
 * and arithmetic is free. Adding `created_at` to two `select` lists is the
 * entire cost of the feature.
 *
 * The boundary is exclusive at the start of the older window and inclusive at
 * `now`, so a record can never land in both halves and none can fall between
 * them.
 */
function comparePeriods(
  days: number,
  rfqs: { created_at: string | null }[],
  quotes: { created_at: string | null }[],
  orders: { confirmed_at: string | null; total: number | string | null }[],
): PeriodComparison {
  const now = Date.now();
  const span = days * 86_400_000;
  const currentFrom = now - span;
  const previousFrom = now - span * 2;

  const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const inWindow = (t: number, from: number, to: number) => !Number.isNaN(t) && t >= from && t < to;

  const blank = (): PeriodStats => ({ demand: 0, quotations: 0, orders: 0, orderValue: 0 });
  const current = blank();
  const previous = blank();

  for (const r of rfqs) {
    const t = at(r.created_at);
    if (inWindow(t, currentFrom, now + 1)) current.demand += 1;
    else if (inWindow(t, previousFrom, currentFrom)) previous.demand += 1;
  }
  for (const q of quotes) {
    const t = at(q.created_at);
    if (inWindow(t, currentFrom, now + 1)) current.quotations += 1;
    else if (inWindow(t, previousFrom, currentFrom)) previous.quotations += 1;
  }
  for (const o of orders) {
    const t = at(o.confirmed_at);
    const value = Number(o.total ?? 0);
    if (inWindow(t, currentFrom, now + 1)) {
      current.orders += 1;
      current.orderValue += value;
    } else if (inWindow(t, previousFrom, currentFrom)) {
      previous.orders += 1;
      previous.orderValue += value;
    }
  }

  return { days, current, previous };
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
 * Everything the supply-side dashboard and report need, in one call.
 *
 * Structured exactly like `purchaseSummary` and for the same reason: the tiles,
 * the funnel, the customer ranking, the product ranking and the monthly trend are
 * all aggregates of the SAME three record sets, and asking the database for them
 * five times to render one page is pure waste. Each read selects only the columns
 * its aggregates need — never the record sets themselves, which the module lists
 * fetch separately and with their own pagination.
 *
 * The line-item read is conditional on purpose: it is the only query here whose
 * cost scales with history rather than with the page, so an organization that has
 * not yet won an order pays nothing for a product ranking it has no data for.
 */
export async function supplySummary(
  supabase: DB,
  orgId: string,
  f: ReportFilters = {},
  trendMonths = 6,
  /**
   * Ask for a window-over-window comparison of this length, in days.
   *
   * Only meaningful on an UNFILTERED read: the comparison needs the row history
   * either side of the window, and `f.from` would cut the previous window off
   * before it could be counted. The dashboard therefore asks for the whole
   * history and slices it here; the Reports page, which filters, does not ask
   * for a comparison at all.
   */
  compareDays?: number,
): Promise<SupplySummary> {
  const categoryOrderIds = await orderIdsInCategory(supabase, orgId, "supplier_org_id", f.category);

  let rfqQ = supabase.from("rfq_list").select("status, created_at").eq("supplier_org_id", orgId);
  let quoteQ = supabase
    .from("quotation_list")
    .select("status, total, created_at")
    .eq("supplier_org_id", orgId);
  let orderQ = supabase
    .from("order_list")
    .select("id, status, total, requester_name, requester_org_id, confirmed_at")
    .eq("supplier_org_id", orgId);

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
  // A branch filter cannot be honoured on ANY of these three from the seller's
  // seat: `requester_branch_id` is the BUYER's branch, and naming the buyer's
  // depot as though it were the seller's would be a wrong answer rather than a
  // missing one. The supply-side report therefore does not offer the filter (see
  // the page), and this query deliberately ignores it if one is passed.
  if (categoryOrderIds) orderQ = orderQ.in("id", categoryOrderIds);

  const [rfqs, quotes, orders] = await Promise.all([rfqQ, quoteQ, orderQ]);
  if (rfqs.error) throw rfqs.error;
  if (quotes.error) throw quotes.error;
  if (orders.error) throw orders.error;

  const rfqRows = rfqs.data ?? [];
  const quoteRows = quotes.data ?? [];
  const orderRows = orders.data ?? [];

  const byCustomer = new Map<string, { orders: number; value: number }>();
  const customerIds = new Set<string>();
  for (const r of orderRows) {
    const name = r.requester_name ?? "—";
    const cur = byCustomer.get(name) ?? { orders: 0, value: 0 };
    cur.orders += 1;
    cur.value += Number(r.total ?? 0);
    byCustomer.set(name, cur);
    if (r.requester_org_id) customerIds.add(r.requester_org_id);
  }

  const undecided = quoteRows.filter((q) => q.status === "submitted");

  return {
    demand: tally(rfqRows),
    // Counted from the same rows as the tally rather than a second head query —
    // it IS the tally's `submitted` bucket, named because it is the number the
    // dashboard leads with.
    awaitingResponse: rfqRows.filter((r) => r.status === "submitted").length,
    quotations: tally(quoteRows),
    awaitingDecision: undecided.length,
    awaitingDecisionValue: undecided.reduce((s, q) => s + Number(q.total ?? 0), 0),
    acceptedValue: quoteRows
      .filter((q) => q.status === "accepted")
      .reduce((s, q) => s + Number(q.total ?? 0), 0),
    orders: tally(orderRows),
    orderValue: orderRows.reduce((s, o) => s + Number(o.total ?? 0), 0),
    activeCustomers: customerIds.size,
    topCustomers: [...byCustomer.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    topProducts: await topOrderedProducts(
      supabase,
      orderRows.map((o) => o.id).filter((id): id is string => !!id),
    ),
    trend: monthlyTrend(orderRows, trendMonths),
    period: compareDays ? comparePeriods(compareDays, rfqRows, quoteRows, orderRows) : undefined,
  };
}

/**
 * This organization's own lines, ranked by ordered value.
 *
 * Ranked on `order_items.product_name`, which is a frozen SNAPSHOT of what was
 * actually sold rather than a live foreign key — an order line deliberately keeps
 * no product id, so that renaming or unpublishing a product cannot rewrite
 * history. The consequence is that a product renamed mid-life ranks as two lines;
 * that is the honest reading of the records, and inventing a join back to
 * `products` would silently merge two different things that were sold under two
 * different names.
 */
async function topOrderedProducts(
  supabase: DB,
  orderIds: string[],
): Promise<{ name: string; quantity: number; value: number }[]> {
  if (orderIds.length === 0) return [];
  // Batched because the id list travels in the URL: an organization with a few
  // hundred orders would otherwise build a request the gateway rejects outright,
  // turning a busy seller's dashboard into an error page. See `batches`.
  const results = await Promise.all(
    batches(orderIds).map((batch) =>
      supabase.from("order_items").select("product_name, quantity, line_total").in("order_id", batch),
    ),
  );

  const byProduct = new Map<string, { quantity: number; value: number }>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const r of data ?? []) {
      const cur = byProduct.get(r.product_name) ?? { quantity: 0, value: 0 };
      cur.quantity += Number(r.quantity ?? 0);
      cur.value += Number(r.line_total ?? 0);
      byProduct.set(r.product_name, cur);
    }
  }
  return [...byProduct.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
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
