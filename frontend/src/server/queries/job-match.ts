import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { toMatchBreakdown, type MatchBreakdown } from "@/lib/installer/overall-match";

type DB = SupabaseClient<Database>;

/**
 * The caller's Overall Match for ONE job — the job page's read of the SAME database authority every card uses
 * (`job_matches` -> `app.job_match_rows`). The caller is `auth.uid()` inside the function; nothing here names a user,
 * a trade, a place or an availability, so there is nothing to spoof.
 *
 * Null means the database returned no row: the job is not one the caller can see (neither discoverable now nor one
 * they applied to). It is presentation only — a missing or zero match never blocks opening or applying to a job.
 */
export const getJobMatch = cache(async function getJobMatch(supabase: DB, jobId: string): Promise<MatchBreakdown | null> {
  const { data, error } = await supabase.rpc("job_matches", { p_job_ids: [jobId] });
  if (error) throw error;
  const row = data?.[0];
  return row ? toMatchBreakdown(row) : null;
});
