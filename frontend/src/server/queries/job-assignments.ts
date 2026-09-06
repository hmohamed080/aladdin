import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

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

/** Every assignment that is the caller's, newest first. */
export async function listMyAssignments(supabase: DB): Promise<MyAssignmentRow[]> {
  const { data, error } = await supabase
    .from("my_job_assignments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
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
