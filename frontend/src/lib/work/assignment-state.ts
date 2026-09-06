import type { Database } from "@/types/database.types";

/**
 * The assignment state model — PURE, and deliberately not in `server/queries`.
 *
 * It started there, beside the reads, and `server-only` threw the moment a
 * client component imported `readyForCompletion`. That guard was right: none of
 * this is server code. Every function below is a total function of a row that
 * has already been fetched, and the surfaces that need the answers — the
 * featured card, the list row, the assignment detail, the poster's panel, the
 * `/home` block — are all client components.
 *
 * So this is the same split `lib/nav/personal-modules.ts` makes for the same
 * reason: the derivation is separated from the fetch, which keeps it importable
 * from either side and unit-testable without a database.
 *
 * NOTHING HERE IS AN AUTHORITY DECISION. Each predicate mirrors a guard the RPC
 * enforces and decides only what to OFFER; the database refuses regardless. In
 * particular there is no completion predicate, because completion is the posting
 * organization's alone (§3.5) and there is no installer-side action to gate.
 */

export type JobAssignmentStatus = Database["public"]["Enums"]["job_assignment_status"];

/**
 * The subset of a row these functions actually read.
 *
 * A structural type rather than the view row, so the poster's `job_assignments`
 * row and the installer's `my_job_assignments` row both satisfy it — the state
 * model is the same on both sides of the engagement, and two copies of it would
 * be two answers to "what does 100 percent mean".
 */
export type AssignmentState = {
  status: JobAssignmentStatus | string | null;
  latest_progress_percent?: number | null;
};

/** The four REAL assignment states, in lifecycle order. */
export const ASSIGNMENT_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;

/**
 * The states that count as work the caller still has in front of them.
 *
 * A composite of two real statuses, and NOT a fifth one. It exists because the
 * reference's first tab is "current" and that is genuinely the question somebody
 * opens the page with — but it is computed from `status` every time it is used
 * and stored nowhere, so there is no fifth value for a future reader to mistake
 * for a database state.
 */
export const CURRENT_STATUSES: readonly JobAssignmentStatus[] = ["scheduled", "in_progress"];

/** How many assignments sit in each state — the tab counts, from real rows. */
export function countAssignmentsByStatus<T extends AssignmentState>(
  rows: readonly T[],
): Record<JobAssignmentStatus, number> {
  const out = Object.fromEntries(ASSIGNMENT_STATUSES.map((s) => [s, 0])) as Record<
    JobAssignmentStatus,
    number
  >;
  for (const r of rows) {
    if (r.status && r.status in out) out[r.status as JobAssignmentStatus] += 1;
  }
  return out;
}

/** Assignments still live: scheduled or under way. */
export function currentAssignments<T extends AssignmentState>(rows: readonly T[]): T[] {
  return rows.filter(
    (r) => r.status && CURRENT_STATUSES.includes(r.status as JobAssignmentStatus),
  );
}

/**
 * The ONE assignment the page leads with, or null.
 *
 * Work under way outranks work merely booked, because the installer's next
 * action lives there — everything else on the page is context for it. Within a
 * group the first wins, which matches the list's own `created_at desc` ordering
 * so the featured record is never one the reader has to hunt for below.
 *
 * The database permits exactly one non-cancelled assignment per JOB, not per
 * installer, so a busy professional legitimately has several. Featuring one is a
 * composition decision and not a claim that there is only one.
 */
export function featuredAssignment<T extends AssignmentState>(rows: readonly T[]): T | null {
  const live = currentAssignments(rows);
  return live.find((r) => r.status === "in_progress") ?? live[0] ?? null;
}

/**
 * §14, the whole rule in one line: 100 percent is NOT completion.
 *
 * A DERIVED presentation state — `in_progress` with the latest reported figure
 * at 100 — and deliberately not persisted. There is no fifth
 * `job_assignment_status`, no `waiting_review` column, and adding one would make
 * the installer's claim look like a state the installer had authority to set.
 * The assignment stays `in_progress` until the posting organization confirms.
 */
export function readyForCompletion(a: AssignmentState): boolean {
  return a.status === "in_progress" && (a.latest_progress_percent ?? 0) >= 100;
}

/** Mirrors `job_assignment_start`: only the installer, only from `scheduled`. */
export function canStart(a: AssignmentState): boolean {
  return a.status === "scheduled";
}

/** Mirrors `job_progress_add`: only while the work is actually under way. */
export function canReportProgress(a: AssignmentState): boolean {
  return a.status === "in_progress";
}

/**
 * Mirrors `job_assignment_cancel`, which admits EITHER party from either live
 * state. The installer half of that authority is offered on their assignment
 * detail; the poster half on the poster's own surface.
 */
export function canCancel(a: AssignmentState): boolean {
  return a.status === "scheduled" || a.status === "in_progress";
}
