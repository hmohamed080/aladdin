import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { PUBLIC_PAGE_SIZE, type Facets, type PublicPage, type PublicProduct, type PublicSort } from "@/features/marketplace/live/public-contract";

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
  inStock?: boolean;
  /** attribute key → option keys */
  attrs?: Record<string, string[]>;
}): Promise<PublicPage | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_catalog_page", {
    p_category: params.category || undefined,
    p_type: params.type || undefined,
    p_query: params.query?.slice(0, 100) || undefined,
    p_sort: params.sort,
    p_limit: PUBLIC_PAGE_SIZE,
    p_offset: (Math.max(1, params.page) - 1) * PUBLIC_PAGE_SIZE,
    p_price_min: params.priceMin ?? undefined,
    p_price_max: params.priceMax ?? undefined,
    p_in_stock: params.inStock ?? false,
    p_attrs: params.attrs && Object.keys(params.attrs).length ? params.attrs : undefined,
  });
  if (error || !data) return null;
  return data as unknown as PublicPage;
}

export async function loadPublicFacets(type?: string | null): Promise<Facets> {
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
