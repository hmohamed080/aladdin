import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listCatalogPage } from "@/server/queries/commerce";
import { resolveProductImage, signProductImageUrls } from "@/server/queries/product-images";
import { loadEngineerCollections } from "@/server/queries/engineer-collections";
import type { CatalogBatch } from "@/features/showroom-shell/catalog/catalog-data";
import type { ShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";

/**
 * One bounded batch of the production catalog for an ENGINEER — the same rows, filters, image
 * signing and batch shape the showroom's "Browse products" uses, with the two differences that
 * come from an engineer having no organization: nothing is excluded as "your own products", and
 * "saved" comes from the engineer's personal collection instead of an organization's list.
 */
export async function loadEngineerCatalogBatch(
  supabase: SupabaseClient<Database>,
  params: ShowroomCatalogParams,
  offset: number,
  limit: number,
): Promise<CatalogBatch> {
  const { rows, total } = await listCatalogPage(
    supabase,
    null,
    { search: params.q, categoryCode: params.category, supplierOrgId: params.supplier },
    offset,
    limit,
  );
  const [signed, collections] = await Promise.all([
    signProductImageUrls(supabase, rows.map((p) => p.primary_image_key), { orgId: null }),
    loadEngineerCollections(),
  ]);
  const saved = new Set(
    (collections.find((c) => c.kind === "saved")?.entries ?? []).filter((e) => e.type === "product").map((e) => e.id),
  );
  const imageUrls: Record<string, string> = {};
  for (const p of rows) {
    const url = p.id ? resolveProductImage(p, signed) : null;
    if (p.id && url) imageUrls[p.id] = url;
  }
  const ids = rows.flatMap((p) => (p.id ? [p.id] : []));
  return { products: rows, total, imageUrls, savedIds: ids.filter((id) => saved.has(id)) };
}
