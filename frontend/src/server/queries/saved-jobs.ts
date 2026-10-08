import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * The caller's SAVED opportunities.
 *
 * Caller-scoped inside the database (RLS on `saved_jobs`): nothing here passes a user id, so nothing here could be
 * pointed at somebody else. (The match of a job is no longer read here: every page of the board already carries the
 * canonical Overall Match, and the detail page reads `job_matches`.)
 */

type DB = SupabaseClient<Database>;

/**
 * Which of THESE jobs the caller has saved (and that are still discoverable). Asked
 * for the cards on screen only, so it never depends on how many jobs the caller has
 * saved in total. A saved job that has closed is kept in `saved_jobs` but is not
 * here, so it never shows on the active board as if it were live.
 */
export async function listSavedAmong(supabase: DB, jobIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("saved_job_opportunities").select("job_id").in("job_id", ids);
  if (error) throw error;
  return (data ?? []).map((r) => r.job_id).filter((id): id is string => Boolean(id));
}

/** How many of the caller's saved jobs are still on the board — an exact count, not the length of a capped list. */
export async function countSavedOpportunities(supabase: DB): Promise<number> {
  const { count, error } = await supabase.from("saved_job_opportunities").select("job_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/** Every job the caller has saved, available or not — so "N no longer available" can be stated. */
export async function countSavedJobRows(supabase: DB): Promise<number> {
  const { count, error } = await supabase.from("saved_jobs").select("job_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}
