import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Typed wrappers over the Increment 6 Jobs RPCs.
 *
 * Every one is a single `.rpc()` call and nothing else. No authorization
 * decision is made in this file, no lifecycle rule is re-implemented, and no
 * function writes a `jobs`, `job_applications` or `job_assignments` row directly
 * — there is no client grant that would let it. The database decides; this layer
 * only carries the caller's JWT to it and lets the error through.
 *
 * ONE ACTION, ONE RPC. `acceptApplication` in particular must never grow a
 * second statement: the sibling auto-rejection, the assignment insert and the
 * job's move to `awarded` all happen inside `job_application_accept`, in one
 * transaction. A UI that "helpfully" also rejected the others would be running
 * half of a transaction outside it.
 */

type Client = SupabaseClient<Database>;

export async function createJob(
  supabase: Client,
  input: {
    orgId: string;
    title: string;
    tradeKey: string;
    offeredAmount: number;
    description?: string;
    governorate?: string;
    city?: string;
    siteAddress?: string;
    expectedDurationDays?: number;
    startsOn?: string;
    endsBy?: string;
    branchId?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("job_create", {
    p_org_id: input.orgId,
    p_title: input.title,
    p_trade_key: input.tradeKey,
    p_offered_amount: input.offeredAmount,
    p_description: input.description,
    p_governorate: input.governorate,
    p_city: input.city,
    p_site_address: input.siteAddress,
    p_expected_duration_days: input.expectedDurationDays,
    p_starts_on: input.startsOn,
    p_ends_by: input.endsBy,
    p_branch_id: input.branchId,
  });
  if (error) throw error;
  return data as string;
}

export async function updateJob(
  supabase: Client,
  input: {
    jobId: string;
    expectedVersion: number;
    title: string;
    tradeKey: string;
    offeredAmount: number;
    description?: string;
    governorate?: string;
    city?: string;
    siteAddress?: string;
    expectedDurationDays?: number;
    startsOn?: string;
    endsBy?: string;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("job_update", {
    p_job_id: input.jobId,
    p_expected_version: input.expectedVersion,
    p_title: input.title,
    p_trade_key: input.tradeKey,
    p_offered_amount: input.offeredAmount,
    p_description: input.description,
    p_governorate: input.governorate,
    p_city: input.city,
    p_site_address: input.siteAddress,
    p_expected_duration_days: input.expectedDurationDays,
    p_starts_on: input.startsOn,
    p_ends_by: input.endsBy,
  });
  if (error) throw error;
  return data as number;
}

export async function publishJob(
  supabase: Client,
  jobId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_publish", {
    p_job_id: jobId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return data as number;
}

export async function closeJob(
  supabase: Client,
  jobId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_close", {
    p_job_id: jobId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return data as number;
}

export async function cancelJob(
  supabase: Client,
  jobId: string,
  expectedVersion: number,
  reason?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_cancel", {
    p_job_id: jobId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) throw error;
  return data as number;
}

/**
 * The award. Returns the assignment id the database created.
 *
 * Everything else the award implies happens inside this one call.
 */
export async function acceptApplication(supabase: Client, applicationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("job_application_accept", {
    p_application_id: applicationId,
  });
  if (error) throw error;
  return data as string;
}

export async function rejectApplication(
  supabase: Client,
  applicationId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("job_application_reject", {
    p_application_id: applicationId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * Apply for a job, or return a withdrawn candidacy to `submitted`.
 *
 * ONE RPC for both, and that is the Increment 6 contract rather than a shortcut:
 * `job_application_submit` reuses the SAME row when the caller has a withdrawn
 * one, so re-applying keeps its `created_at` and cannot produce a duplicate
 * candidacy. A second "reapply" wrapper would be a second way to write the same
 * row, and the two would eventually disagree.
 *
 * Returns the application id, existing or new — the call is idempotent, so a
 * double tap returns the candidacy that already exists.
 */
export async function submitApplication(
  supabase: Client,
  jobId: string,
  note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("job_application_submit", {
    p_job_id: jobId,
    p_note: note ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

/** Withdraw the caller's own candidacy. Only the applicant may. */
export async function withdrawApplication(
  supabase: Client,
  applicationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("job_application_withdraw", {
    p_application_id: applicationId,
  });
  if (error) throw error;
}

/* ------------------------------------------------------------------------- */
/* Assignment lifecycle (Increment 9).                                        */
/*                                                                            */
/* Four wrappers, four RPCs, and the actor split is the DATABASE's, reproduced */
/* here only as a comment. `job_assignment_start` and `job_progress_add` refuse */
/* anyone but the assigned installer; `job_assignment_complete` refuses anyone  */
/* but a `job.manage` holder in the posting organization; `job_assignment_      */
/* cancel` admits either party. No wrapper re-checks any of that, because a     */
/* check here would be a second opinion that can disagree with the first.       */
/* ------------------------------------------------------------------------- */

/** Begin work. The ASSIGNED INSTALLER only, and only from `scheduled`. */
export async function startAssignment(
  supabase: Client,
  assignmentId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_assignment_start", {
    p_assignment_id: assignmentId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Append one progress report. The ASSIGNED INSTALLER only.
 *
 * This moves NO status, including at 100 — reaching 100 is a claim of readiness
 * that the posting organization then confirms (§3.5). A caller that follows this
 * with a completion call would be asserting an authority it does not have, and
 * the database would refuse it.
 */
export async function addProgress(
  supabase: Client,
  input: { assignmentId: string; percent: number; stage?: string; note?: string },
): Promise<string> {
  const { data, error } = await supabase.rpc("job_progress_add", {
    p_assignment_id: input.assignmentId,
    p_progress_percent: input.percent,
    p_stage: input.stage ?? undefined,
    p_note: input.note ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Confirm the work is done. THE POSTING ORGANIZATION ONLY.
 *
 * The single most important authority line in this domain, and the reason this
 * wrapper exists in a file the installer's surfaces also import: there must be
 * exactly one of it, so that "who may call this" is answered once. It completes
 * the assignment AND the job in one transaction inside the RPC.
 */
export async function completeAssignment(
  supabase: Client,
  assignmentId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_assignment_complete", {
    p_assignment_id: assignmentId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return data as number;
}

/**
 * End the engagement. EITHER party, with a reason.
 *
 * The assignment is cancelled and never deleted, and an awarded job returns to
 * `open` — previously rejected candidacies stay rejected. All of that happens
 * inside the RPC; there is nothing for a caller to do afterwards.
 */
export async function cancelAssignment(
  supabase: Client,
  assignmentId: string,
  expectedVersion: number,
  reason: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("job_assignment_cancel", {
    p_assignment_id: assignmentId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) throw error;
  return data as number;
}
