import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Organization-side Jobs reads.
 *
 * Every function here takes the caller-scoped client, so RLS decides what comes
 * back — none of them re-implements an authority check, and none may. The org id
 * a list is filtered by comes from `getPageContext()`, never from a URL: a
 * tampered id buys an empty result rather than another tenant's work, because
 * the policy underneath still asks about `auth.uid()`.
 */

type DB = SupabaseClient<Database>;

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
export type JobApplicantRow = Database["public"]["Views"]["job_applicants"]["Row"];
export type JobAssignmentRow = Database["public"]["Tables"]["job_assignments"]["Row"];
export type JobStatus = Database["public"]["Enums"]["job_status"];
export type JobApplicationStatus = Database["public"]["Enums"]["job_application_status"];

/** The six states, in lifecycle order — a filter cannot invent a seventh. */
export const JOB_STATUSES = [
  "draft",
  "open",
  "awarded",
  "completed",
  "closed",
  "cancelled",
] as const;

const LIST_LIMIT = 100;

/** A job as the management list needs it: the row, its trade KEY, its volume. */
export type JobListRow = JobRow & {
  tradeKey: string | null;
  /** True when that trade has since been retired — the label is history, not an
      offer the poster could still choose today. */
  tradeRetired: boolean;
  applicationCount: number;
};

type JobsSelect = JobRow & {
  trades: { key: string } | null;
  job_applications: { count: number }[];
};

/**
 * Restore the labels the embed could not read.
 *
 * `jobs -> trades(key)` returns null for a RETIRED trade, because
 * `trades_select_active` withholds inactive rows — so a job the organization
 * posted itself, in a trade it chose itself, loses its label the day the
 * platform retires that trade. The row is intact underneath; only the read is
 * blocked. `job_trade_labels` is the poster-scoped seam that answers for those,
 * and `20260903090002` explains why it is a projection rather than one more
 * policy on `trades` (a policy would put the retired trade back in the "post a
 * job" dropdown).
 *
 * A SECOND REQUEST ONLY WHEN ONE IS OWED. Nothing is retired today, so this
 * returns before issuing anything and the list keeps costing exactly one round
 * trip — the same reason `isPosterVerified` is a separate call rather than a
 * column on every B2B page's context.
 */
async function withHistoricalTradeLabels(
  supabase: DB,
  rows: JobListRow[],
): Promise<JobListRow[]> {
  const missing = rows.filter((r) => r.tradeKey === null).map((r) => r.id);
  if (missing.length === 0) return rows;

  const { data, error } = await supabase
    .from("job_trade_labels")
    .select("job_id, trade_key, trade_is_active")
    .in("job_id", missing);
  if (error) throw error;

  const labels = new Map((data ?? []).map((l) => [l.job_id, l]));
  return rows.map((r) => {
    if (r.tradeKey !== null) return r;
    const l = labels.get(r.id);
    // Still null when even the seam cannot answer — platform support reading a
    // job whose organization they are not a member of. A dash, not a crash.
    return l?.trade_key
      ? { ...r, tradeKey: l.trade_key, tradeRetired: l.trade_is_active === false }
      : r;
  });
}

/**
 * Every job this organization has posted, newest first.
 *
 * The trade arrives as an EMBEDDED key rather than a second round trip, and the
 * application count as an embedded aggregate rather than N queries — one request
 * answers "what have we posted, in what trade, and how many people want it",
 * which is the entire question the list page asks.
 *
 * The embed can come back null even though `jobs.trade_id` is `not null`:
 * `trades_select_active` withholds RETIRED rows from ordinary callers. That is
 * what `withHistoricalTradeLabels` repairs, and why the hot path still costs
 * exactly one request.
 */
export async function listOrgJobs(
  supabase: DB,
  orgId: string,
  status?: JobStatus,
): Promise<JobListRow[]> {
  let q = supabase
    .from("jobs")
    .select("*, trades(key), job_applications(count)")
    .eq("poster_org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as unknown as JobsSelect[]).map((j) => ({
    ...j,
    tradeKey: j.trades?.key ?? null,
    tradeRetired: false,
    applicationCount: j.job_applications?.[0]?.count ?? 0,
  }));
  return withHistoricalTradeLabels(supabase, rows);
}

/** One job, with its trade key. Null when RLS says the caller cannot see it. */
export const getOrgJob = cache(async function getOrgJob(
  supabase: DB,
  jobId: string,
): Promise<JobListRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*, trades(key), job_applications(count)")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const j = data as unknown as JobsSelect;
  const row: JobListRow = {
    ...j,
    tradeKey: j.trades?.key ?? null,
    tradeRetired: false,
    applicationCount: j.job_applications?.[0]?.count ?? 0,
  };
  return (await withHistoricalTradeLabels(supabase, [row]))[0]!;
});

/**
 * The applicants for one job, through the poster-side projection.
 *
 * Not `job_applications` directly: that table carries `applicant_user_id` and no
 * name, so a screen built on it would either show uuids or need a second read of
 * a profile the poster cannot open. `job_applicants` is scoped to the caller's
 * own organization inside its definer, so there is no org parameter to get wrong.
 *
 * Ordered so the queue reads the way it is worked: live candidacies first, then
 * the decided ones, oldest application first within each group — whoever has
 * been waiting longest is at the top.
 */
export async function listJobApplicants(
  supabase: DB,
  jobId: string,
): Promise<JobApplicantRow[]> {
  const { data, error } = await supabase
    .from("job_applicants")
    .select("*")
    .eq("job_id", jobId)
    .order("applied_at", { ascending: true })
    .limit(LIST_LIMIT);
  if (error) throw error;
  const rows = data ?? [];
  const rank = (s: string | null) => (s === "submitted" ? 0 : s === "accepted" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status));
}

/**
 * The live engagement for a job, if it has one.
 *
 * `status <> 'cancelled'` mirrors `ux_job_assignments_active_job`: a job can
 * accumulate cancelled assignments over successive rounds, and exactly one of
 * them can be live. Asking for "the assignment" without that filter would return
 * whichever row the planner happened to reach first.
 */
export async function getActiveAssignment(
  supabase: DB,
  jobId: string,
): Promise<JobAssignmentRow | null> {
  const { data, error } = await supabase
    .from("job_assignments")
    .select("*")
    .eq("job_id", jobId)
    .neq("status", "cancelled")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** How many jobs sit in each state — the list page's tiles, in one round trip. */
export function countByStatus(rows: JobListRow[]): Record<JobStatus, number> {
  const out = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}

/**
 * Is this organization currently able to have its jobs discovered?
 *
 * A DELIBERATELY SEPARATE READ, not a field on `OrgContext`. The workspace
 * loader never touches the `organizations` row — it derives everything from the
 * membership entries — and adding a column to it would spend a round trip on
 * every B2B page render to answer a question one screen asks. So the detail page
 * calls this only when it is about to offer Publish.
 *
 * It is also the reason the answer is never cached onto a job: the database asks
 * the same question live inside `job_publish`, and this is only the UI finding
 * out in advance which of two things to render.
 */
export async function isPosterVerified(supabase: DB, orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .select("is_verified, status, deleted_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.is_verified && data.status === "active" && !data.deleted_at);
}
