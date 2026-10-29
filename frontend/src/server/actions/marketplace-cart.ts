"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { CART_MAX_LINES, type CartQuote, type CartRef } from "@/features/marketplace/live/public-contract";

/**
 * Prices the guest cart (Migration 12). Public on purpose — a visitor has no account — and
 * read-only: the database resolves each slug + SKU to a currently published product of an enabled
 * showroom and answers with price, availability and each showroom's delivery fee for the chosen
 * place. Nothing is stored and no stock is reserved. The browser's own idea of a price is never used.
 *
 * Returns null when the quote could not be produced (bad input, database error); the page then says
 * so instead of guessing.
 */
const KEY = /^[a-z0-9-]{1,40}$/;

export async function quoteMarketplaceCartAction(
  refs: CartRef[],
  governorate: string | null,
  area: string | null,
): Promise<CartQuote | null> {
  if (!Array.isArray(refs) || refs.length > CART_MAX_LINES) return null;
  const lines: CartRef[] = [];
  for (const r of refs) {
    if (!r || typeof r.slug !== "string" || typeof r.sku !== "string") return null;
    if (!/^[a-z0-9-]{1,120}$/.test(r.slug) || r.sku.length < 1 || r.sku.length > 80) return null;
    lines.push({ slug: r.slug, sku: r.sku });
  }
  const gov = governorate && KEY.test(governorate) ? governorate : undefined;
  const place = gov && area && KEY.test(area) ? area : undefined;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_public_cart", {
    p_lines: lines,
    p_governorate: gov,
    p_area: place,
  });
  if (error || !data) return null;
  return data as unknown as CartQuote;
}
