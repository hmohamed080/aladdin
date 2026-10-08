import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type DB = SupabaseClient<Database>;

export type SavedSearchScope = "work" | "jobs";
export type SavedSearchRow = { id: string; name: string; filters: Record<string, string> };

/**
 * The caller's saved searches for one page, oldest first. RLS scopes the rows to
 * their owner; `filters` is read back only as the flat string map the database
 * guarantees (a CHECK constraint refuses anything else), and any non-string is
 * dropped rather than trusted.
 */
export async function listSavedSearches(supabase: DB, scope: SavedSearchScope): Promise<SavedSearchRow[]> {
  const { data, error } = await supabase
    .from("saved_searches")
    .select("id, name, filters")
    .eq("scope", scope)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    filters: Object.fromEntries(
      Object.entries((r.filters ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
  }));
}
