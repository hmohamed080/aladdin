import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { WorkKeyset } from "@/server/pagination/cursor";

/**
 * The installer's own WORK, as distinct from their applications.
 *
 * `my_job_applications` answers "what did I put myself forward for"; this file
 * answers "what am I actually doing". They are deliberately two read models and
 * two surfaces, because they are two different states of the world and merging
 * them would make "accepted" mean both "you won" and "you are working".
 *
 * `my_job_assignments` is scoped to `auth.uid()` inside its definer and takes no
 * parameter, so nothing here can be pointed at another professional's work. The
 * progress history is read from `public.job_progress_updates` DIRECTLY — its RLS
 * already admits both parties of the parent assignment, so no seam was added for
 * it, and none should be.
 *
 * NO AUTHORITY LIVES HERE, and no derivation either: the state model moved to
 * `lib/work/assignment-state` the moment a client component needed it, and is
 * re-exported at the foot of this file. What remains is I/O. Nothing in this
 * file — and nothing on any surface it feeds — can complete an assignment. That
 * is the posting organization's alone (§3.5).
 */

type DB = SupabaseClient<Database>;

export type MyAssignmentRow = Database["public"]["Views"]["my_job_assignments"]["Row"];
export type { JobAssignmentStatus } from "@/lib/work/assignment-state";
export type ProgressUpdateRow = {
  id: string;
  progress_percent: number;
  stage: string | null;
  note: string | null;
  created_at: string;
};

const LIST_LIMIT = 100;

/**
 * Every assignment that is the caller's, newest first — CAPPED at `LIST_LIMIT`.
 *
 * That cap is fine for what still calls this (the dashboard's "what is current" and the
 * profile's completed count, which want a handful of rows). It is NOT how the My Work
 * page reads: that is `listMyWorkPage` below, a real database range with an exact total.
 */
export async function listMyAssignments(supabase: DB): Promise<MyAssignmentRow[]> {
  const { data, error } = await supabase
    .from("my_job_assignments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/* ------------------------------------------------------------------------- */
/* MY WORK — the page, paged for real                                         */
/* ------------------------------------------------------------------------- */

/** One row of `my_work_page`: the assignment, plus the work contact the database released for it (or nulls). */
export type WorkPageRow = Database["public"]["Functions"]["my_work_page"]["Returns"][number];

export type WorkPageQuery = {
  /** The statuses to include. Empty / omitted = the database's own default: in progress + completed. */
  states?: readonly JobAssignmentStatusName[];
  search?: string;
  /** An exact organization name. */
  company?: string;
  /** ISO days; the planned work window must overlap [from, to]. Either may be omitted. */
  from?: string;
  to?: string;
  contact?: "all" | "available" | "none";
  sort?: "default" | "recent-added" | "last-added" | "oldest-first" | "last-action";
  /** How many rows to return (1..300). */
  limit: number;
  /** Where the page starts: the keys of the last row already shown (null = the first page). */
  after?: WorkKeyset | null;
};
type JobAssignmentStatusName = Database["public"]["Enums"]["job_assignment_status"];

/**
 * One REAL page of the caller's work, by KEYSET. Search, company, planned range, contact, status and
 * ordering are all applied by the database (`public.my_work_page`), which also counts the EXACT
 * filtered total — so the page never fetches rows just to count or filter them, and an installer with
 * a thousand assignments gets the same exact figures as one with six. The page is the `limit` rows
 * AFTER `after` in the sort's total order (it ends on the assignment id), so an assignment arriving,
 * leaving or moving while the installer pages cannot repeat or swallow a row. One extra row is read to
 * learn whether another page exists, and `next` is the position after the last row returned.
 * `total` is null only for an empty page past the end (the board already holds the exact total).
 */
export async function listMyWorkPage(
  supabase: DB,
  q: WorkPageQuery,
): Promise<{ rows: WorkPageRow[]; total: number | null; next: WorkKeyset | null }> {
  const sort = q.sort ?? "default";
  const take = Math.max(Math.floor(q.limit), 1);
  const { data, error } = await supabase.rpc("my_work_page", {
    p_states: q.states?.length ? [...q.states] : undefined,
    p_search: q.search || undefined,
    p_company: q.company || undefined,
    p_from: q.from || undefined,
    p_to: q.to || undefined,
    p_contact: q.contact ?? "all",
    p_sort: sort,
    p_limit: take + 1,
    p_after_key: q.after?.key ?? undefined,
    p_after_key2: q.after?.key2 ?? undefined,
    p_after_id: q.after?.id ?? undefined,
  });
  if (error) throw error;
  const fetched = data ?? [];
  const rows = fetched.slice(0, take);
  const last = rows[rows.length - 1];
  const next: WorkKeyset | null =
    fetched.length > take && last
      ? sort === "last-action"
        ? { sort, key: last.last_progress_at, key2: last.created_at, id: last.id }
        : { sort, key: last.created_at, key2: null, id: last.id }
      : null;
  return { rows, total: fetched.length ? Number(fetched[0]!.total_count) : q.after ? null : 0, next };
}

/** The exact number of the caller's assignments in each status — a COUNT in the database, for the tabs and the summary rail. */
export async function countMyAssignments(supabase: DB): Promise<Record<JobAssignmentStatusName, number>> {
  const { data, error } = await supabase.rpc("my_work_counts");
  if (error) throw error;
  const out: Record<JobAssignmentStatusName, number> = { scheduled: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const r of data ?? []) out[r.status] = Number(r.assignment_count);
  return out;
}

/** The organizations the caller has work with — the Company filter's options. */
export async function listWorkCompanies(supabase: DB): Promise<string[]> {
  const { data, error } = await supabase.rpc("my_work_companies");
  if (error) throw error;
  return (data ?? []).map((r) => r.company).filter((c): c is string => Boolean(c));
}

/**
 * The ONE assignment the page leads with: work under way outranks work merely booked,
 * newest first inside each — the same rule as `featuredAssignment`, asked of the
 * database rather than of a fetched list.
 */
export async function getFeaturedAssignment(supabase: DB): Promise<MyAssignmentRow | null> {
  for (const status of ["in_progress", "scheduled"] as const) {
    const { data, error } = await supabase
      .from("my_job_assignments")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0];
  }
  return null;
}

/**
 * One assignment of the caller's, by id.
 *
 * Null means "not yours or not there", and the route says the same thing for
 * both — the id in the URL is a lookup key, never the authority.
 */
export const getMyAssignment = cache(async function getMyAssignment(
  supabase: DB,
  assignmentId: string,
): Promise<MyAssignmentRow | null> {
  const { data, error } = await supabase
    .from("my_job_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/**
 * The assignment ids for a set of the caller's own applications — the §20
 * bridge.
 *
 * An accepted application and its assignment are joined by
 * `job_assignments.application_id`, which is a real foreign key written once by
 * `job_application_accept`. The bridge asks the database for it rather than
 * deriving it: an id guessed on the client is an id that can be wrong, and the
 * one place this relationship is authoritative is the row itself.
 *
 * One read for a whole page of applications, not one per row.
 */
export async function assignmentIdsByApplication(
  supabase: DB,
  applicationIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(applicationIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("my_job_assignments")
    .select("id, application_id")
    .in("application_id", ids);
  if (error) throw error;
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    if (r.application_id && r.id) out.set(r.application_id, r.id);
  }
  return out;
}

/**
 * The append-only progress history for one assignment, newest first.
 *
 * Read straight from the base table: `job_progress_select_parties` admits the
 * assigned installer AND members of the posting organization, so this ONE
 * function serves both sides of the engagement and there is no second poster
 * copy of it to drift.
 *
 * `author_user_id` is not selected. Every row on an assignment is authored by
 * the installer — `job_progress_add` refuses anyone else — so the column adds no
 * information here and would only put a raw user id into a component's props.
 */
export async function listProgressUpdates(
  supabase: DB,
  assignmentId: string,
): Promise<ProgressUpdateRow[]> {
  const { data, error } = await supabase
    .from("job_progress_updates")
    .select("id, progress_percent, stage, note, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/**
 * The reviews the caller RECEIVED for these assignments, keyed by assignment id.
 *
 * Read from `job_reviews` directly: `job_reviews_select_installer` admits the
 * assigned installer, so it can only ever return the caller's own. One read for the
 * whole page, never one per row. An assignment with no review is simply absent.
 */
export async function listAssignmentReviews(
  supabase: DB,
  assignmentIds: readonly string[],
): Promise<Map<string, { rating: number }>> {
  const ids = [...new Set(assignmentIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("job_reviews").select("assignment_id, rating").in("assignment_id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.assignment_id, { rating: r.rating }]));
}

/* ------------------------------------------------------------------------- */
/* The derivations live in `lib/work/assignment-state` — PURE, and importable  */
/* from the client components that actually need them. They are re-exported    */
/* here so a server route keeps ONE import for "the assignment model", while   */
/* the `server-only` guard above still stops a client component reaching this  */
/* file for its reads.                                                         */
/* ------------------------------------------------------------------------- */
export {
  ASSIGNMENT_STATUSES,
  CURRENT_STATUSES,
  countAssignmentsByStatus,
  currentAssignments,
  featuredAssignment,
  readyForCompletion,
  canStart,
  canReportProgress,
  canCancel,
} from "@/lib/work/assignment-state";
