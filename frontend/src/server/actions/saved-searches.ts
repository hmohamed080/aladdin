"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import type { SavedSearchScope } from "@/server/queries/saved-searches";

/**
 * Thin Server Actions over `saved_search_create` / `_update` / `_delete`
 * (20261006090002). The owner is `auth.uid()` inside each RPC; the key allow-list,
 * value types, size, scope and per-user ceiling are enforced there, so this decides
 * nothing. `filters` is only ever a flat string map here, and it is stored as data
 * the page re-applies — never executed.
 */
export type SavedSearchActionResult = { ok: true; id?: string } | { ok: false; code: "duplicate" | "limit" | "invalid" | "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(error: { code?: string }): SavedSearchActionResult {
  if (error.code === "23505") return { ok: false, code: "duplicate" };
  if (error.code === "54000") return { ok: false, code: "limit" };
  if (error.code === "22023") return { ok: false, code: "invalid" };
  return { ok: false, code: "failed" };
}

function asStringMap(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => typeof v === "string" && v !== ""));
}

export async function createSavedSearchAction(
  scope: SavedSearchScope,
  name: string,
  filters: Record<string, string>,
): Promise<SavedSearchActionResult> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("saved_search_create", { p_scope: scope, p_name: name, p_filters: asStringMap(filters) });
  return error ? failure(error) : { ok: true, id: data as string };
}

export async function updateSavedSearchAction(
  id: string,
  patch: { name?: string; filters?: Record<string, string> },
): Promise<SavedSearchActionResult> {
  if (!UUID.test(id)) return { ok: false, code: "failed" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("saved_search_update", {
    p_id: id,
    p_name: patch.name,
    p_filters: patch.filters ? asStringMap(patch.filters) : undefined,
  });
  return error ? failure(error) : { ok: true, id };
}

export async function deleteSavedSearchAction(id: string): Promise<SavedSearchActionResult> {
  if (!UUID.test(id)) return { ok: false, code: "failed" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("saved_search_delete", { p_id: id });
  return error ? failure(error) : { ok: true, id };
}
