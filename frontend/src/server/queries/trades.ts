import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The canonical trade taxonomy, from the two sides the profile reads it.
 *
 * `loadTradeCatalog` is the VOCABULARY — every active trade, in the order the
 * table itself defines. `loadMyTrades` is the caller's own SELECTION. They are
 * separate because they answer different questions and have different lifetimes:
 * the vocabulary is reference data identical for every caller, the selection is
 * one person's statement about themselves.
 *
 * NEITHER TAKES A USER ID, and that is the point rather than an omission. The
 * only identity these can read is the session's own: `user_trades_select_self`
 * restricts the row to `auth.uid()`, so passing someone else's id here would
 * return nothing rather than their trades. Another person's trades are reached
 * through `profile_public_directory` — the approved public projection — and
 * nowhere else.
 *
 * TRADES GRANT NOTHING. Nothing in this module is consulted to decide what a
 * caller may do, and nothing should be: a declared trade is a discovery and
 * display signal, and an installer may take work outside it (O5). If a future
 * page ever gates on `primaryKey`, that is the bug, not this file.
 */

/** One trade in the canonical vocabulary. `key` is the i18n label key. */
export type Trade = { id: string; key: string };

/** The caller's own selection: every trade they hold, and the one they lead with. */
export type MyTrades = {
  /** Active trades only, primary first, then the vocabulary's own order. */
  keys: string[];
  /** Null when the caller holds no trades at all — a normal, complete state. */
  primaryKey: string | null;
};

/**
 * Every ACTIVE trade, in `sort_order`.
 *
 * Inactive rows are absent because RLS withholds them (`trades_select_active`),
 * not because of a filter here — a retired trade is not a thing this page should
 * be able to offer even by accident.
 *
 * `cache()`d per render: the editor renders the catalog and the same page's
 * summary counts against it.
 */
export const loadTradeCatalog = cache(async function loadTradeCatalog(): Promise<Trade[]> {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("trades")
    .select("id, key")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });

  return (data ?? []).map((t) => ({ id: t.id, key: t.key }));
});

/**
 * The caller's own trades.
 *
 * Sorted HERE rather than left to the database, because the ordering has to
 * match the public projection's exactly — primary first, then `sort_order` — or
 * the same professional lists their trades in one order on their own profile and
 * another on their public page, and the reader has no way to know which is
 * meaningful.
 */
export const loadMyTrades = cache(async function loadMyTrades(): Promise<MyTrades> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { keys: [], primaryKey: null };

  const { data } = await supabase
    .from("user_trades")
    .select("is_primary, trades!inner(key, sort_order, is_active)")
    .eq("user_id", user.id);

  const rows = (data ?? [])
    // An INACTIVE trade the person still holds is not shown as a current claim.
    // The row survives — the database keeps history through a retirement — but
    // the profile stops publishing a trade the platform has withdrawn, exactly
    // as `profile_public_directory` does.
    .filter((r) => r.trades?.is_active)
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        (a.trades?.sort_order ?? 0) - (b.trades?.sort_order ?? 0) ||
        (a.trades?.key ?? "").localeCompare(b.trades?.key ?? ""),
    );

  return {
    keys: rows.map((r) => r.trades!.key),
    primaryKey: rows.find((r) => r.is_primary)?.trades?.key ?? null,
  };
});
