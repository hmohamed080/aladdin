"use server";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Thin Server Actions over `job_save` / `job_unsave` (20261006090001). The owner is
 * `auth.uid()` inside the RPC — there is no user argument here to forge — and a job
 * that is not currently discoverable is refused by the database, so this decides
 * nothing itself. Failures return a bare `{ ok: false }`: the board says "could not
 * save" in the viewer's language, never a database message.
 */
export type SavedJobActionResult = { ok: true } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setJobSavedAction(jobId: string, saved: boolean): Promise<SavedJobActionResult> {
  if (!UUID.test(jobId)) return { ok: false };
  const supabase = await getServerSupabase();
  const { error } = saved
    ? await supabase.rpc("job_save", { p_job_id: jobId })
    : await supabase.rpc("job_unsave", { p_job_id: jobId });
  return error ? { ok: false } : { ok: true };
}
