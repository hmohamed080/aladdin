import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "@/server/queries/sales";

/**
 * Read queries for the B2B commerce workspace (Catalog / RFQ / Quotation).
 * Every query runs through the caller-scoped client, so RLS enforces tenant and
 * requester/supplier visibility in the database (ADR-0008). The UI never filters
 * for security — only for UX. A filter can narrow results but never widen them
 * past what RLS already allows.
 */

type DB = SupabaseClient<Database>;

export type CatalogRow = Database["public"]["Views"]["catalog_published_products"]["Row"];
export type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export type RfqRow = Database["public"]["Tables"]["rfqs"]["Row"];
export type RfqListRow = Database["public"]["Views"]["rfq_list"]["Row"];
export type RfqItemRow = Database["public"]["Tables"]["rfq_items"]["Row"];
export type QuotationRow = Database["public"]["Tables"]["quotations"]["Row"];
export type QuotationListRow = Database["public"]["Views"]["quotation_list"]["Row"];
export type QuotationItemRow = Database["public"]["Tables"]["quotation_items"]["Row"];
export type ProductCategory = Database["public"]["Enums"]["product_category"];
/** The status values these views actually carry — a filter cannot invent one. */
export type RfqStatus = NonNullable<RfqListRow["status"]>;
export type QuotationStatus = NonNullable<QuotationListRow["status"]>;

const LIST_LIMIT = 100;

// ---- Catalog (cross-tenant, published only) --------------------------------
export type CatalogFilters = { search?: string; category?: ProductCategory; supplierOrgId?: string };

export async function listCatalog(supabase: DB, f: CatalogFilters = {}): Promise<CatalogRow[]> {
  let q = supabase
    .from("catalog_published_products")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (f.category) q = q.eq("category", f.category);
  if (f.supplierOrgId) q = q.eq("organization_id", f.supplierOrgId);
  if (f.search && f.search.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getCatalogProduct(supabase: DB, id: string): Promise<CatalogRow | null> {
  const { data, error } = await supabase
    .from("catalog_published_products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Own-organization products (management) --------------------------------
export async function listOwnProducts(
  supabase: DB,
  orgId: string,
  f: { search?: string; status?: "draft" | "published"; category?: ProductCategory } = {},
): Promise<ProductRow[]> {
  let q = supabase
    .from("products")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (f.status) q = q.eq("status", f.status);
  if (f.category) q = q.eq("category", f.category);
  if (f.search && f.search.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * How this organization's shelf splits by publication state.
 *
 * Read UNFILTERED on purpose: these are the counts behind the status tabs, and a
 * tab that reported the size of the filtered view would make its own filter
 * invisible ("Draft (0)" while standing on a search that excludes every draft).
 * One read of one column, tallied here — `products.status` has exactly two
 * values, so there is nothing here worth a second round trip.
 *
 * Note there is no third "unpublished" state to report: `product_status` is
 * `draft | published`, and unpublishing returns a product to draft. The UI must
 * not invent a state the model does not have.
 */
export async function ownProductCounts(
  supabase: DB,
  orgId: string,
): Promise<{ total: number; published: number; draft: number }> {
  const { data, error } = await supabase
    .from("products")
    .select("status")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (error) throw error;
  const rows = data ?? [];
  const published = rows.filter((r) => r.status === "published").length;
  return { total: rows.length, published, draft: rows.length - published };
}

export type ProductDemand = { requests: number; orderedQuantity: number };

/**
 * Per-product demand: how often each of this organization's products has been
 * ASKED FOR, and how much of it has been ordered.
 *
 * This is the one piece of context that turns a product list into a product
 * MANAGEMENT surface — "this line gets requested and never converts" is a
 * decision a seller can act on, where a row of names is not.
 *
 * Two bounded reads rather than a nested join: the org's own RFQ ids, then their
 * line items. Requests come from `rfq_items.product_id`, which is a live
 * reference — an RFQ names a catalog product. Quantities come from the same
 * place; ORDER lines deliberately cannot be used here, because an order item is a
 * frozen snapshot with no product id (see `topOrderedProducts`), and matching one
 * back by name would attribute a renamed product's history to the wrong row.
 */
export async function productDemand(
  supabase: DB,
  orgId: string,
): Promise<Map<string, ProductDemand>> {
  const { data: rfqs, error: rfqErr } = await supabase
    .from("rfq_list")
    .select("id")
    .eq("supplier_org_id", orgId);
  if (rfqErr) throw rfqErr;

  const ids = (rfqs ?? []).map((r) => r.id).filter((id): id is string => !!id);
  const out = new Map<string, ProductDemand>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("rfq_items")
    .select("rfq_id, product_id, quantity")
    .in("rfq_id", ids);
  if (error) throw error;

  // Counted per REQUEST, not per line: an RFQ that lists the same product twice
  // (two finishes, two delivery dates) is still one business asking once, and a
  // "requested 2 times" that means "one request, itemised twice" is a number a
  // seller would act on wrongly.
  const seen = new Map<string, Set<string>>();
  for (const item of data ?? []) {
    // A free-text line (no catalog product behind it) is real demand, but it is
    // not demand for a PRODUCT, so it belongs to no row here.
    if (!item.product_id) continue;
    const cur = out.get(item.product_id) ?? { requests: 0, orderedQuantity: 0 };
    cur.orderedQuantity += Number(item.quantity ?? 0);
    const rfqSet = seen.get(item.product_id) ?? new Set<string>();
    if (item.rfq_id && !rfqSet.has(item.rfq_id)) {
      rfqSet.add(item.rfq_id);
      cur.requests += 1;
    }
    seen.set(item.product_id, rfqSet);
    out.set(item.product_id, cur);
  }
  return out;
}

export async function getProduct(supabase: DB, id: string): Promise<ProductRow | null> {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- RFQs ------------------------------------------------------------------
export type RfqSide = "requester" | "supplier";

export async function listRfqs(
  supabase: DB,
  orgId: string,
  side: RfqSide,
): Promise<RfqListRow[]> {
  const col = side === "requester" ? "requester_org_id" : "supplier_org_id";
  const { data, error } = await supabase
    .from("rfq_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/**
 * The most recent RFQs on one side, WITH how many match in total.
 *
 * A dashboard panel wants both: five rows to show and the real number for its tile.
 * PostgREST returns an exact count alongside a limited result set, so this is one
 * round trip that answers both questions — rather than a hundred rows fetched so the
 * page can slice five off the front and call `.length` on the rest. Same view, same
 * RLS, same ordering as `listRfqs`; only the row budget differs.
 */
export async function recentRfqs(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  opts: { statuses?: readonly RfqStatus[]; limit?: number } = {},
): Promise<{ rows: RfqListRow[]; total: number }> {
  const col = side === "requester" ? "requester_org_id" : "supplier_org_id";
  let q = supabase
    .from("rfq_list")
    .select("*", { count: "exact" })
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (opts.statuses) q = q.in("status", opts.statuses);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getRfq(supabase: DB, id: string): Promise<RfqRow | null> {
  const { data, error } = await supabase.from("rfqs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRfqDisplay(supabase: DB, id: string): Promise<RfqListRow | null> {
  const { data, error } = await supabase.from("rfq_list").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRfqItems(supabase: DB, rfqId: string): Promise<RfqItemRow[]> {
  const { data, error } = await supabase
    .from("rfq_items")
    .select("*")
    .eq("rfq_id", rfqId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The live (non-rejected) quotation for an RFQ, if any. */
export async function getLiveQuotationForRfq(
  supabase: DB,
  rfqId: string,
): Promise<QuotationRow | null> {
  const { data, error } = await supabase
    .from("quotations")
    .select("*")
    .eq("rfq_id", rfqId)
    .neq("status", "rejected")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Quotations ------------------------------------------------------------
export async function listQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
): Promise<QuotationListRow[]> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  const { data, error } = await supabase
    .from("quotation_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** The most recent quotations on one side, with the matching total (see `recentRfqs`). */
export async function recentQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  opts: { statuses?: readonly QuotationStatus[]; limit?: number } = {},
): Promise<{ rows: QuotationListRow[]; total: number }> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  let q = supabase
    .from("quotation_list")
    .select("*", { count: "exact" })
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (opts.statuses) q = q.in("status", opts.statuses);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * How many quotations match, WITHOUT transferring them. `head: true` sends no rows
 * at all — Postgres counts and returns the number in a header, which is what a KPI
 * tile with no list behind it actually needs.
 */
export async function countQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  statuses?: readonly QuotationStatus[],
): Promise<number> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  let q = supabase.from("quotation_list").select("*", { count: "exact", head: true }).eq(col, orgId);
  if (statuses) q = q.in("status", statuses);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getQuotation(supabase: DB, id: string): Promise<QuotationRow | null> {
  const { data, error } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getQuotationDisplay(
  supabase: DB,
  id: string,
): Promise<QuotationListRow | null> {
  const { data, error } = await supabase
    .from("quotation_list")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listQuotationItems(
  supabase: DB,
  quotationId: string,
): Promise<QuotationItemRow[]> {
  const { data, error } = await supabase
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ---- Saved products (organization shortlist) -------------------------------
export type SavedProductRow = Database["public"]["Views"]["saved_product_list"]["Row"];

/**
 * The calling organization's shortlist. RLS scopes rows to the caller's org, and
 * the view's join to `catalog_published_products` means an item whose supplier
 * later unpublished or deleted it simply drops out — no stale or leaked row.
 */
export async function listSavedProducts(
  supabase: DB,
  orgId: string,
  f: { category?: ProductCategory } = {},
): Promise<SavedProductRow[]> {
  let q = supabase
    .from("saved_product_list")
    .select("*")
    .eq("organization_id", orgId)
    .order("saved_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (f.category) q = q.eq("category", f.category);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * How many products are on the shortlist. The shortlist view joins through to the
 * published catalog, so counting it via the list query meant materializing every
 * joined row to read one number off `.length`.
 */
export async function countSavedProducts(supabase: DB, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("saved_product_list")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) throw error;
  return count ?? 0;
}

/** The saved product ids for this org, so the catalog can show its save state. */
export async function savedProductIds(supabase: DB, orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("saved_products")
    .select("product_id")
    .eq("organization_id", orgId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.product_id));
}
