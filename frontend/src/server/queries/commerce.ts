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
  f: { search?: string; status?: "draft" | "published" } = {},
): Promise<ProductRow[]> {
  let q = supabase
    .from("products")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (f.status) q = q.eq("status", f.status);
  if (f.search && f.search.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
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

/** The saved product ids for this org, so the catalog can show its save state. */
export async function savedProductIds(supabase: DB, orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("saved_products")
    .select("product_id")
    .eq("organization_id", orgId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.product_id));
}
