import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read queries for the caller's OWN Points ledger.
 *
 * AUTHORITY IS `user_id`, AND IT IS ENFORCED IN THE DATABASE.
 * `public.points_ledger` carries exactly two SELECT policies —
 * `user_id = auth.uid()` and a platform-support path — and no organization,
 * capability, branch or counterparty read path at all
 * (`docs/database/points-core.md`, "Authority and RLS"). Every query below runs
 * on the caller-scoped client and adds NO ownership filter of its own: there is
 * nothing to add that RLS has not already decided, and a duplicated check in
 * TypeScript would only be a second place to get it wrong.
 *
 * NOTHING HERE ACCEPTS A USER ID.
 * `public.points_balance(p_user_id)` does take one, and is deliberately called
 * with NO argument so it defaults to `auth.uid()`. Threading a caller-supplied
 * id through this layer would create the one shape the product must not have —
 * a browser asking about somebody else — even though RLS would return zero for
 * it. The parameter simply never leaves the database.
 *
 * `organization_id` IS BUSINESS CONTEXT AND NOTHING ELSE. It says where an
 * entry was earned so a row can be explained; it is never an authorization
 * input, and it is never used to widen or select what the caller may read.
 */

type DB = SupabaseClient<Database>;

export type PointsEntryRow = Database["public"]["Tables"]["points_ledger"]["Row"];

/**
 * Bounded by construction, like the notification inbox.
 *
 * A Points page is a RECENT history, not an archive: the rows a person wants
 * are the ones that just changed their standing. A cap means a long history
 * degrades into a shorter list rather than a slow page, and "show more" raises
 * it in fixed steps up to `POINTS_HISTORY_MAX` instead of unbounding it.
 */
export const POINTS_HISTORY_LIMIT = 20;
export const POINTS_HISTORY_MAX = 100;

/** Clamp an untrusted "how many rows" input to the bounded range. */
export function resolveHistoryLimit(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return POINTS_HISTORY_LIMIT;
  return Math.min(Math.max(n, POINTS_HISTORY_LIMIT), POINTS_HISTORY_MAX);
}

/**
 * The caller's derived balance — `SUM(points_delta)`, computed in the database.
 *
 * NEVER recomputed here from the fetched rows. The history is capped, so a sum
 * over what happens to be on screen would silently disagree with the ledger the
 * moment someone has more than `POINTS_HISTORY_LIMIT` entries — which is the
 * mutable-balance failure the whole model was shaped to avoid, reintroduced at
 * the read layer.
 *
 * A negative result is returned as-is. It is a real state after a correction,
 * and clamping it would hide the very adjustment the person needs to see.
 */
export async function getPointsBalance(supabase: DB): Promise<number> {
  const { data, error } = await supabase.rpc("points_balance");
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}

/**
 * The caller's recent history, newest first.
 *
 * `created_at desc` is both the useful order and the free one — it matches
 * `ix_points_ledger_user_created`. Reversals are ordinary rows here: a
 * compensating entry appears in its own right, above the award it corrects, and
 * the original stays exactly as written.
 */
export async function listPointsEntries(
  supabase: DB,
  { limit = POINTS_HISTORY_LIMIT }: { limit?: number } = {},
): Promise<PointsEntryRow[]> {
  const { data, error } = await supabase
    .from("points_ledger")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Display names for the organizations a set of entries were earned at.
 *
 * Deliberately a plain caller-scoped read of `public.organizations`, whose own
 * RLS (`organizations_select_member`) decides what comes back. That is the
 * whole authorization story: a name resolves when the reader is still a member
 * of that business, and silently does not when they are not.
 *
 * NOTHING IS BROADENED TO MAKE A LABEL APPEAR. An entry whose organization the
 * caller can no longer read simply renders without context — the entry itself
 * is theirs and always shows. Adding a cross-tenant lookup so that a departed
 * employer's name could be printed would trade a real tenancy boundary for a
 * caption.
 */
export async function resolveEntryOrganizationNames(
  supabase: DB,
  entries: readonly PointsEntryRow[],
): Promise<Map<string, string>> {
  const ids = [...new Set(entries.map((e) => e.organization_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("organizations").select("id, name").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((o) => [o.id, o.name]));
}
