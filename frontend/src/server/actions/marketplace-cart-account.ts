"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { isMarketplaceOrderingEnabled } from "@/lib/env";
import { CART_MAX_LINES, CART_MAX_QTY, type StoredCartLine } from "@/features/marketplace/live/public-contract";

/**
 * The signed-in cart of the Marketplace (PR 11). The browser keeps the cart as slug + SKU + quantity; these actions
 * move it to and from the account cart through RPCs that run as the signed-in buyer (RLS and the own-showroom rule
 * apply). Nothing here carries a price, and nothing runs while ordering is off.
 *
 *   merge    the guest cart joins the account cart, exactly once per merge key (a retry with the same key is a replay)
 *   replace  the browser mirror of the account cart is pushed (a line of the buyer's own showroom is refused)
 *   pull     the account cart is read
 */
export type CartSyncInput =
  | { mode: "merge"; key: string; lines: StoredCartLine[] }
  | { mode: "replace"; lines: StoredCartLine[] }
  | { mode: "pull" };

export type CartSyncResult =
  | { ok: true; lines: StoredCartLine[]; replayed?: boolean; skipped?: number; ownShowroom?: number }
  | { ok: false; code: "disabled" | "signed_out" | "own_showroom" | "closed" | "invalid" | "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanLines(value: unknown): StoredCartLine[] | null {
  if (!Array.isArray(value) || value.length > CART_MAX_LINES) return null;
  const out: StoredCartLine[] = [];
  for (const l of value) {
    if (!l || typeof l !== "object") return null;
    const { slug, sku, qty } = l as Record<string, unknown>;
    if (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/.test(slug)) return null;
    if (typeof sku !== "string" || sku.length < 1 || sku.length > 80) return null;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > CART_MAX_QTY) return null;
    out.push({ slug, sku, qty });
  }
  return out;
}

function readCart(data: unknown): StoredCartLine[] | null {
  const lines = (data as { lines?: unknown } | null)?.lines;
  return cleanLines(lines);
}

function codeOf(message: string | undefined): Extract<CartSyncResult, { ok: false }>["code"] {
  if (!message) return "failed";
  if (message.startsWith("mp:own_showroom")) return "own_showroom";
  if (message.startsWith("mp:marketplace_closed")) return "closed";
  if (message.startsWith("mp:auth_required") || message.startsWith("mp:account_inactive")) return "signed_out";
  if (message.startsWith("mp:invalid") || message.startsWith("mp:too_many") || message.startsWith("mp:duplicate")) return "invalid";
  return "failed";
}

export async function syncMarketplaceCartAction(input: CartSyncInput): Promise<CartSyncResult> {
  if (!isMarketplaceOrderingEnabled()) return { ok: false, code: "disabled" };
  if (!input || typeof input !== "object") return { ok: false, code: "invalid" };
  const supabase = await getServerSupabase();

  if (input.mode === "pull") {
    const { data, error } = await supabase.rpc("marketplace_cart_get");
    const lines = error ? null : readCart(data);
    return lines ? { ok: true, lines } : { ok: false, code: codeOf(error?.message) };
  }

  const lines = cleanLines(input.lines);
  if (!lines) return { ok: false, code: "invalid" };

  if (input.mode === "merge") {
    if (typeof input.key !== "string" || !UUID.test(input.key)) return { ok: false, code: "invalid" };
    const { data, error } = await supabase.rpc("marketplace_cart_merge", { p_merge_key: input.key, p_lines: lines });
    const merged = error ? null : readCart(data);
    if (!merged) return { ok: false, code: codeOf(error?.message) };
    const d = data as { replayed?: boolean; skipped?: number; own_showroom?: number };
    return { ok: true, lines: merged, replayed: d.replayed === true, skipped: d.skipped ?? 0, ownShowroom: d.own_showroom ?? 0 };
  }

  if (input.mode === "replace") {
    const { data, error } = await supabase.rpc("marketplace_cart_replace", { p_lines: lines });
    const saved = error ? null : readCart(data);
    return saved ? { ok: true, lines: saved } : { ok: false, code: codeOf(error?.message) };
  }
  return { ok: false, code: "invalid" };
}
