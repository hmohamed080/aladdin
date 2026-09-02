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
