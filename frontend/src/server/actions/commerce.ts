import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Trusted B2B commerce workflow boundaries (Phase 3, Sprint 9 — Catalog / RFQ /
 * Quotation). Thin, typed wrappers over the server-side security-definer RPCs.
 * ALL authorization (organization scope, capability checks, lifecycle rules),
 * tenant isolation, optimistic concurrency, and audit emission live in the
 * database functions (ADR-0008). These wrappers only forward the CALLER's JWT via
 * a caller-scoped server client — no privileged logic, no service-role client, no
 * authorization decision duplicated in TypeScript.
 */

type Client = SupabaseClient<Database>;
type ProductCategory = Database["public"]["Enums"]["product_category"];
type ProductUnit = Database["public"]["Enums"]["product_unit"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, rpc: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${rpc} returned an invalid identifier.`);
  }
  return value;
}
function requireVersion(value: unknown, rpc: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${rpc} returned an invalid version.`);
  }
  return value;
}

// ---- Products --------------------------------------------------------------
export async function createProduct(
  supabase: Client,
  input: {
    orgId: string;
    name: string;
    category: ProductCategory;
    unit: ProductUnit;
    sku?: string;
    brand?: string;
    shortDescription?: string;
    imageRef?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_product", {
    p_org_id: input.orgId,
    p_name: input.name,
    p_category: input.category,
    p_unit: input.unit,
    ...(input.sku ? { p_sku: input.sku } : {}),
    ...(input.brand ? { p_brand: input.brand } : {}),
    ...(input.shortDescription ? { p_short_description: input.shortDescription } : {}),
    ...(input.imageRef ? { p_image_ref: input.imageRef } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_product");
}

export async function updateProduct(
  supabase: Client,
  productId: string,
  expectedVersion: number,
  patch: {
    name?: string;
    category?: ProductCategory;
    unit?: ProductUnit;
    sku?: string;
    brand?: string;
    shortDescription?: string;
    clearSku?: boolean;
    clearBrand?: boolean;
    clearDescription?: boolean;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("update_product", {
    p_product_id: productId,
    p_expected_version: expectedVersion,
    ...(patch.name !== undefined ? { p_name: patch.name } : {}),
    ...(patch.category !== undefined ? { p_category: patch.category } : {}),
    ...(patch.unit !== undefined ? { p_unit: patch.unit } : {}),
    ...(patch.sku !== undefined ? { p_sku: patch.sku } : {}),
    ...(patch.brand !== undefined ? { p_brand: patch.brand } : {}),
    ...(patch.shortDescription !== undefined ? { p_short_description: patch.shortDescription } : {}),
    ...(patch.clearSku ? { p_clear_sku: true } : {}),
    ...(patch.clearBrand ? { p_clear_brand: true } : {}),
    ...(patch.clearDescription ? { p_clear_description: true } : {}),
  });
  if (error) throw error;
  return requireVersion(data, "update_product");
}

export async function setProductPublished(
  supabase: Client,
  productId: string,
  published: boolean,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_product_published", {
    p_product_id: productId,
    p_published: published,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "set_product_published");
}

// ---- RFQ (requester side) --------------------------------------------------
export async function createRfq(
  supabase: Client,
  input: {
    requesterOrgId: string;
    supplierOrgId: string;
    title: string;
    note?: string;
    requiredDate?: string;
    branchId?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_rfq", {
    p_requester_org_id: input.requesterOrgId,
    p_supplier_org_id: input.supplierOrgId,
    p_title: input.title,
    ...(input.note ? { p_note: input.note } : {}),
    ...(input.requiredDate ? { p_required_date: input.requiredDate } : {}),
    ...(input.branchId ? { p_branch_id: input.branchId } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_rfq");
}

export async function addRfqItem(
  supabase: Client,
  input: { rfqId: string; productId: string; quantity: number; note?: string },
): Promise<string> {
  const { data, error } = await supabase.rpc("add_rfq_item", {
    p_rfq_id: input.rfqId,
    p_product_id: input.productId,
    p_quantity: input.quantity,
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "add_rfq_item");
}

export async function removeRfqItem(supabase: Client, itemId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_rfq_item", { p_item_id: itemId });
  if (error) throw error;
}

export async function updateRfq(
  supabase: Client,
  rfqId: string,
  expectedVersion: number,
  patch: {
    title?: string;
    note?: string;
    requiredDate?: string;
    clearNote?: boolean;
    clearRequiredDate?: boolean;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("update_rfq", {
    p_rfq_id: rfqId,
    p_expected_version: expectedVersion,
    ...(patch.title !== undefined ? { p_title: patch.title } : {}),
    ...(patch.note !== undefined ? { p_note: patch.note } : {}),
    ...(patch.requiredDate !== undefined ? { p_required_date: patch.requiredDate } : {}),
    ...(patch.clearNote ? { p_clear_note: true } : {}),
    ...(patch.clearRequiredDate ? { p_clear_required_date: true } : {}),
  });
  if (error) throw error;
  return requireVersion(data, "update_rfq");
}

export async function submitRfq(
  supabase: Client,
  rfqId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("submit_rfq", {
    p_rfq_id: rfqId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "submit_rfq");
}

export async function cancelRfq(supabase: Client, rfqId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_rfq", { p_rfq_id: rfqId });
  if (error) throw error;
}

// ---- Quotation (supplier side + requester decision) ------------------------
export async function createQuotation(
  supabase: Client,
  input: { rfqId: string; note?: string; validityDate?: string },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_quotation", {
    p_rfq_id: input.rfqId,
    ...(input.note ? { p_note: input.note } : {}),
    ...(input.validityDate ? { p_validity_date: input.validityDate } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_quotation");
}

export async function setQuotationItemPrice(
  supabase: Client,
  itemId: string,
  unitPrice: number,
): Promise<void> {
  const { error } = await supabase.rpc("set_quotation_item_price", {
    p_item_id: itemId,
    p_unit_price: unitPrice,
  });
  if (error) throw error;
}

export async function updateQuotation(
  supabase: Client,
  quotationId: string,
  expectedVersion: number,
  patch: { note?: string; validityDate?: string; clearNote?: boolean; clearValidity?: boolean },
): Promise<number> {
  const { data, error } = await supabase.rpc("update_quotation", {
    p_quotation_id: quotationId,
    p_expected_version: expectedVersion,
    ...(patch.note !== undefined ? { p_note: patch.note } : {}),
    ...(patch.validityDate !== undefined ? { p_validity_date: patch.validityDate } : {}),
    ...(patch.clearNote ? { p_clear_note: true } : {}),
    ...(patch.clearValidity ? { p_clear_validity: true } : {}),
  });
  if (error) throw error;
  return requireVersion(data, "update_quotation");
}

export async function submitQuotation(
  supabase: Client,
  quotationId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("submit_quotation", {
    p_quotation_id: quotationId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "submit_quotation");
}

export async function decideQuotation(
  supabase: Client,
  quotationId: string,
  accept: boolean,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("decide_quotation", {
    p_quotation_id: quotationId,
    p_accept: accept,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "decide_quotation");
}
