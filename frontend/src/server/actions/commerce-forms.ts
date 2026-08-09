"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import * as commerce from "@/server/actions/commerce";
import { mapCommerceError, isStaleVersion } from "@/server/actions/error-mapping";
import type { Database } from "@/types/database.types";

/**
 * Server Actions the commerce forms bind to. They translate FormData → the typed
 * server-only commerce helpers (which forward the caller JWT to the RPCs). No
 * authorization decision is made here — the database decides and we map its
 * outcome to a translation KEY. Errors are never swallowed.
 */

export type FormState = {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
};

type ProductCategory = Database["public"]["Enums"]["product_category"];
type ProductUnit = Database["public"]["Enums"]["product_unit"];

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function num(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function optionalPatch(fd: FormData, key: string): { value?: string; clear?: boolean } {
  if (!fd.has(key)) return {};
  const raw = fd.get(key);
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed === "" ? { clear: true } : { value: trimmed };
}

// ===========================================================================
// Products
// ===========================================================================
export async function createProductAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  const name = str(fd, "name");
  const category = str(fd, "category") as ProductCategory | undefined;
  const unit = str(fd, "unit") as ProductUnit | undefined;
  if (!orgId) return { ok: false, code: "states.genericRetry" };
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "commerce.validation.nameRequired";
  if (!category) fieldErrors.category = "commerce.validation.categoryRequired";
  if (!unit) fieldErrors.unit = "commerce.validation.unitRequired";
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const supabase = await getServerSupabase();
  let newId: string;
  try {
    newId = await commerce.createProduct(supabase, {
      orgId,
      name: name!,
      category: category!,
      unit: unit!,
      sku: str(fd, "sku"),
      brand: str(fd, "brand"),
      shortDescription: str(fd, "shortDescription"),
      imageRef: str(fd, "imageRef"),
    });
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath("/b2b/products");
  redirect(`/b2b/products/${newId}?created=1`);
}

export async function updateProductAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "productId");
  const version = num(fd, "expectedVersion");
  const name = str(fd, "name");
  if (!id || version === undefined) return { ok: false, code: "states.genericRetry" };
  if (!name) return { ok: false, fieldErrors: { name: "commerce.validation.nameRequired" } };

  const sku = optionalPatch(fd, "sku");
  const brand = optionalPatch(fd, "brand");
  const desc = optionalPatch(fd, "shortDescription");
  const supabase = await getServerSupabase();
  try {
    await commerce.updateProduct(supabase, id, version, {
      name,
      category: str(fd, "category") as ProductCategory | undefined,
      unit: str(fd, "unit") as ProductUnit | undefined,
      sku: sku.value,
      clearSku: sku.clear,
      brand: brand.value,
      clearBrand: brand.clear,
      shortDescription: desc.value,
      clearDescription: desc.clear,
    });
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/products/${id}`);
  revalidatePath("/b2b/products");
  redirect(`/b2b/products/${id}?updated=1`);
}

export async function toggleProductPublishAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "productId");
  const version = num(fd, "expectedVersion");
  const publish = str(fd, "publish") === "true";
  if (!id || version === undefined) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.setProductPublished(supabase, id, publish, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/products/${id}`);
  revalidatePath("/b2b/products");
  revalidatePath("/b2b/catalog");
  return { ok: true, code: publish ? "commerce.flash.published" : "commerce.flash.unpublished" };
}

// ===========================================================================
// RFQ
// ===========================================================================
export async function createRfqAction(_p: FormState, fd: FormData): Promise<FormState> {
  const requesterOrgId = str(fd, "requesterOrgId");
  const supplierOrgId = str(fd, "supplierOrgId");
  const title = str(fd, "title");
  const firstProductId = str(fd, "productId");
  const firstQty = num(fd, "quantity");
  if (!requesterOrgId || !supplierOrgId) return { ok: false, code: "states.genericRetry" };
  if (!title) return { ok: false, fieldErrors: { title: "commerce.validation.titleRequired" } };

  const supabase = await getServerSupabase();
  let rfqId: string;
  try {
    rfqId = await commerce.createRfq(supabase, {
      requesterOrgId,
      supplierOrgId,
      title,
      note: str(fd, "note"),
      requiredDate: str(fd, "requiredDate"),
      branchId: str(fd, "branchId"),
    });
    // Seed the first line when the RFQ was started from a catalog product.
    if (firstProductId && firstQty && firstQty > 0) {
      await commerce.addRfqItem(supabase, { rfqId, productId: firstProductId, quantity: firstQty });
    }
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath("/b2b/rfqs");
  redirect(`/b2b/rfqs/${rfqId}?created=1`);
}

export async function addRfqItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const rfqId = str(fd, "rfqId");
  const productId = str(fd, "productId");
  const quantity = num(fd, "quantity");
  if (!rfqId) return { ok: false, code: "states.genericRetry" };
  if (!productId) return { ok: false, fieldErrors: { productId: "commerce.validation.productRequired" } };
  if (!quantity || quantity <= 0)
    return { ok: false, fieldErrors: { quantity: "commerce.validation.quantityPositive" } };

  const supabase = await getServerSupabase();
  try {
    await commerce.addRfqItem(supabase, { rfqId, productId, quantity, note: str(fd, "note") });
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/rfqs/${rfqId}`);
  return { ok: true, code: "commerce.flash.itemAdded" };
}

export async function removeRfqItemAction(_p: FormState, fd: FormData): Promise<FormState> {
  const itemId = str(fd, "itemId");
  const rfqId = str(fd, "rfqId");
  if (!itemId || !rfqId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.removeRfqItem(supabase, itemId);
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/rfqs/${rfqId}`);
  return { ok: true };
}

export async function submitRfqAction(_p: FormState, fd: FormData): Promise<FormState> {
  const rfqId = str(fd, "rfqId");
  const version = num(fd, "expectedVersion");
  if (!rfqId || version === undefined) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.submitRfq(supabase, rfqId, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/rfqs/${rfqId}`);
  revalidatePath("/b2b/rfqs");
  return { ok: true, code: "commerce.flash.rfqSubmitted" };
}

export async function cancelRfqAction(_p: FormState, fd: FormData): Promise<FormState> {
  const rfqId = str(fd, "rfqId");
  if (!rfqId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.cancelRfq(supabase, rfqId);
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/rfqs/${rfqId}`);
  revalidatePath("/b2b/rfqs");
  return { ok: true, code: "commerce.flash.rfqCancelled" };
}

// ===========================================================================
// Quotation
// ===========================================================================
export async function createQuotationAction(_p: FormState, fd: FormData): Promise<FormState> {
  const rfqId = str(fd, "rfqId");
  if (!rfqId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  let quotationId: string;
  try {
    quotationId = await commerce.createQuotation(supabase, {
      rfqId,
      note: str(fd, "note"),
      validityDate: str(fd, "validityDate"),
    });
  } catch (e) {
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath("/b2b/quotations");
  redirect(`/b2b/quotations/${quotationId}?created=1`);
}

/**
 * Batch-save every line price on a draft quotation in one submit. Each `price_<itemId>`
 * field maps to a `set_quotation_item_price` RPC call (the RPC recomputes totals).
 */
export async function saveQuotationPricesAction(_p: FormState, fd: FormData): Promise<FormState> {
  const quotationId = str(fd, "quotationId");
  if (!quotationId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    for (const [key, raw] of fd.entries()) {
      if (!key.startsWith("price_")) continue;
      const itemId = key.slice("price_".length);
      const price = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(price) || price < 0)
        return { ok: false, fieldErrors: { [key]: "commerce.validation.pricePositive" } };
      await commerce.setQuotationItemPrice(supabase, itemId, price);
    }
    // Optional cover fields (note / validity) if present on the same form.
    if (fd.has("note") || fd.has("validityDate")) {
      const version = num(fd, "expectedVersion");
      if (version !== undefined) {
        const note = optionalPatch(fd, "note");
        const validity = optionalPatch(fd, "validityDate");
        await commerce.updateQuotation(supabase, quotationId, version, {
          note: note.value,
          clearNote: note.clear,
          validityDate: validity.value,
          clearValidity: validity.clear,
        });
      }
    }
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/quotations/${quotationId}`);
  return { ok: true, code: "commerce.flash.pricesSaved" };
}

export async function submitQuotationAction(_p: FormState, fd: FormData): Promise<FormState> {
  const quotationId = str(fd, "quotationId");
  const version = num(fd, "expectedVersion");
  if (!quotationId || version === undefined) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.submitQuotation(supabase, quotationId, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/quotations/${quotationId}`);
  revalidatePath("/b2b/quotations");
  return { ok: true, code: "commerce.flash.quotationSubmitted" };
}

export async function decideQuotationAction(_p: FormState, fd: FormData): Promise<FormState> {
  const quotationId = str(fd, "quotationId");
  const version = num(fd, "expectedVersion");
  const accept = str(fd, "accept") === "true";
  if (!quotationId || version === undefined) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await commerce.decideQuotation(supabase, quotationId, accept, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "commerce.errors.conflict" };
    return { ok: false, code: mapCommerceError(e) };
  }
  revalidatePath(`/b2b/quotations/${quotationId}`);
  revalidatePath("/b2b/quotations");
  return { ok: true, code: accept ? "commerce.flash.accepted" : "commerce.flash.rejected" };
}
