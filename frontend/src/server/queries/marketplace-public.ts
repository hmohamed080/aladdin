import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { PUBLIC_PAGE_SIZE, type BuyerPlace, type DeliveryTerms, type Facets, type PublicPage, type PublicProduct, type PublicSeller, type PublicSort } from "@/features/marketplace/live/public-contract";

/**
 * Public Marketplace reads (Migration 09). Each RPC is granted to anon and
 * returns ONLY published products of currently enabled sellers with an active
 * type/category; image ids appear only while the media flag is on and the image
 * is verified. These loaders add nothing to that gate — they shape the JSON.
 */

export * from "@/features/marketplace/live/public-contract";

export async function loadPublicCatalogPage(params: {
  category?: string | null;
  type?: string | null;
  query?: string | null;
  sort: PublicSort;
  page: number;
  priceMin?: number | null;
  priceMax?: number | null;
  /** attribute key → option keys */
  attrs?: Record<string, string[]>;
  /** only products that ship free (one unit, to the chosen place when there is one) */
  freeShipping?: boolean;
  /** only products whose estimate starts within this many days */
  maxDays?: number | null;
  /** the buyer's place; without it the estimate is the showroom's fastest..slowest range */
  place?: BuyerPlace | null;
  /** public slug of one showroom (its storefront) */
  seller?: string | null;
  limit?: number;
}): Promise<PublicPage | null> {
  const supabase = await getServerSupabase();
  const limit = params.limit ?? PUBLIC_PAGE_SIZE;
  const { data, error } = await supabase.rpc("marketplace_public_browse", {
    p_category: params.category || undefined,
    p_type: params.type || undefined,
    p_query: params.query?.slice(0, 100) || undefined,
    p_sort: params.sort,
    p_limit: limit,
    p_offset: (Math.max(1, params.page) - 1) * limit,
    p_price_min: params.priceMin ?? undefined,
    p_price_max: params.priceMax ?? undefined,
    p_attrs: params.attrs && Object.keys(params.attrs).length ? params.attrs : undefined,
    p_free_shipping: params.freeShipping ?? false,
    p_max_days: params.maxDays ?? undefined,
    p_governorate: params.place?.gov || undefined,
    p_area: params.place?.area || undefined,
    p_seller: params.seller || undefined,
  });
  if (error || !data) return null;
  return data as unknown as PublicPage;
}

/** `false` only when the platform team closed the Marketplace; a failed read counts as open (the pages then show their own empty state). */
export async function loadPublicOpen(): Promise<boolean> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_status");
  if (error || !data) return true;
  return (data as { open?: boolean }).open !== false;
}

export async function loadPublicSeller(slug: string): Promise<PublicSeller | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_seller", { p_slug: slug });
  if (error || !data) return null;
  return data as unknown as PublicSeller;
}

/** The delivery-details block of one product for one buyer place (and, optionally, one variant). */
export async function loadPublicDelivery(slug: string, place: BuyerPlace | null, sku?: string | null): Promise<DeliveryTerms | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_delivery", {
    p_slug: slug,
    p_governorate: place?.gov || undefined,
    p_area: place?.area || undefined,
    p_sku: sku || undefined,
  });
  if (error || !data) return null;
  return data as unknown as DeliveryTerms;
}

/**
 * Facets (category/type tree, filter options, counts, price bounds) are the same for every visitor and change only
 * when a showroom publishes or unpublishes, so a short per-instance memo saves the RPC on a busy catalog. It is
 * deliberately NOT applied to the catalog page, the product, the cart quote or any image: those carry prices,
 * stock and publication state, and their revocation must show on the next request. Failures are never memoized.
 */
const FACETS_TTL_MS = 60_000;
const FACETS_MAX_ENTRIES = 40;
const facetsMemo = new Map<string, { at: number; value: Facets }>();

/** Test seam. */
export function resetFacetsMemoForTests() {
  facetsMemo.clear();
}

export async function loadPublicFacets(type?: string | null): Promise<Facets> {
  const memoKey = type || "";
  const hit = facetsMemo.get(memoKey);
  if (hit && Date.now() - hit.at < FACETS_TTL_MS) return hit.value;
  const value = await readPublicFacets(type);
  if (value.categories.length > 0) {
    if (facetsMemo.size >= FACETS_MAX_ENTRIES) facetsMemo.delete(facetsMemo.keys().next().value as string);
    facetsMemo.set(memoKey, { at: Date.now(), value });
  }
  return value;
}

async function readPublicFacets(type?: string | null): Promise<Facets> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_facets", { p_type: type || undefined });
  const empty: Facets = { categories: [], price: { min: null, max: null }, filters: [] };
  if (error || !data) return empty;
  const raw = data as unknown as Facets;
  return {
    categories: (raw.categories ?? []).map((c) => ({
      ...c,
      count: Number(c.count),
      types: (c.types ?? []).map((t) => ({ ...t, count: Number(t.count) })),
    })),
    price: {
      min: raw.price?.min === null || raw.price?.min === undefined ? null : Number(raw.price.min),
      max: raw.price?.max === null || raw.price?.max === undefined ? null : Number(raw.price.max),
    },
    filters: (raw.filters ?? []).map((f) => ({ ...f, options: (f.options ?? []).map((o) => ({ ...o, count: Number(o.count) })) })),
  };
}

export async function loadPublicProduct(slug: string): Promise<PublicProduct | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_product", { p_slug: slug });
  if (error || !data) return null;
  return data as unknown as PublicProduct;
}
