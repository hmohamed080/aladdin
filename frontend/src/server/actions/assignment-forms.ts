"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  startAssignment,
  addProgress,
  completeAssignment,
  cancelAssignment,
} from "@/server/actions/jobs";
import { mapAssignmentError } from "@/server/actions/error-mapping";
import type { FormState } from "@/server/actions/job-forms";

/**
 * Server Actions for the assignment lifecycle.
 *
 * FOUR ACTIONS, FOUR RPCs, AND ONE AUTHORITY BOUNDARY RUNNING THROUGH THEM.
 * `startWorkAction` and `addProgressAction` are the installer's;
 * `completeAssignmentAction` is the posting organization's and is imported by
 * the B2B job detail alone; `cancelAssignmentAction` is bound on BOTH surfaces
 * because `job_assignment_cancel` admits either party.
 *
 * NOTHING HERE DECIDES WHO MAY DO WHAT. Every refusal in this domain is raised
 * by the RPC, against `auth.uid()`, and would still be raised if this file
 * called all four actions from the wrong surface. What these functions own is
 * parsing a form, carrying the caller's JWT, turning a refusal into a sentence,
 * and revalidating the surfaces whose state actually moved.
 *
 * THERE IS NO COMPLETION ACTION FOR THE INSTALLER, and its absence is the
 * product rule made structural (§16): reporting 100 percent calls
 * `addProgressAction` like any other figure, and the assignment stays
 * `in_progress`. An installer-side "mark complete" would need a fifth function
 * in this file, and there is no RPC for it to call.
 *
 * NOTHING IS OPTIMISTIC. No action reports a new state before the database has
 * returned one, and the version each write carries is the one the caller last
 * read — a stale one comes back as `40001` and is shown as a conflict, not
 * silently retried with a fresher number.
 */

const NOTE_MAX = 1000;
const STAGE_MAX = 80;
const REASON_MAX = 500;

/** The installer's surfaces, plus `/home`, which now leads with current work. */
function revalidateInstaller(assignmentId: string): void {
  revalidatePath("/home");
  revalidatePath("/home/work");
  revalidatePath(`/home/work/${assignmentId}`);
}

/** The poster's surfaces. */
function revalidatePoster(jobId: string): void {
  revalidatePath("/b2b/jobs");
  if (jobId) revalidatePath(`/b2b/jobs/${jobId}`);
}

/**
 * Begin work. `scheduled` -> `in_progress`, and only the assigned installer.
 *
 * The expected version is submitted with the form rather than read again here,
 * which is the point of optimistic concurrency: re-reading it would mean this
 * action always agreed with itself and the check would never fire.
 */
export async function startWorkAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const assignmentId = String(fd.get("assignmentId") ?? "");
  const version = Number(fd.get("expectedVersion"));
  if (!assignmentId || !Number.isFinite(version)) {
    return { ok: false, code: "states.genericRetry" };
  }

  try {
    const supabase = await getServerSupabase();
    await startAssignment(supabase, assignmentId, version);
  } catch (error) {
    return { ok: false, code: mapAssignmentError(error) };
  }

  revalidateInstaller(assignmentId);
  return { ok: true, code: "work.flash.started" };
}

/**
 * Append one progress report.
 *
 * The 0–100 bound is validated here AND in the RPC AND by
 * `ck_job_progress_range`. That is not redundancy for its own sake: the client
 * check saves a round trip on a typo, the RPC is the authority, and the
 * constraint is what makes the rule true for a write path nobody has written
 * yet. The client one is the only one that can be wrong without consequence.
 *
 * 100 is an ordinary value to this action. It reports readiness and moves
 * nothing, exactly as 25 does.
 */
export async function addProgressAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const assignmentId = String(fd.get("assignmentId") ?? "");
  if (!assignmentId) return { ok: false, code: "states.genericRetry" };

  const percent = Number(fd.get("percent"));
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { ok: false, fieldErrors: { percent: "work.validation.progressRange" } };
  }

  const stageRaw = fd.get("stage");
  const stage = typeof stageRaw === "string" ? stageRaw.trim() : "";
  if (stage.length > STAGE_MAX) {
    return { ok: false, fieldErrors: { stage: "work.validation.stageTooLong" } };
  }

  const noteRaw = fd.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (note.length > NOTE_MAX) {
    return { ok: false, fieldErrors: { note: "work.validation.noteTooLong" } };
  }

  try {
    const supabase = await getServerSupabase();
    await addProgress(supabase, {
      assignmentId,
      percent,
      stage: stage || undefined,
      note: note || undefined,
    });
  } catch (error) {
    return { ok: false, code: mapAssignmentError(error) };
  }

  revalidateInstaller(assignmentId);
  // The poster's view of this job carries the same figure, and at 100 it now
  // carries a decision.
  revalidatePoster(String(fd.get("jobId") ?? ""));
  return { ok: true, code: "work.flash.progressAdded" };
}

/**
 * Confirm the work is done. THE POSTING ORGANIZATION ONLY.
 *
 * Bound on the B2B job detail and nowhere else. If it were ever imported by an
 * installer surface the database would still refuse — `job_assignment_complete`
 * asks `app.can_manage_job` about the caller — but the import itself would be
 * the mistake, and a test asserts the installer's components do not make it.
 */
export async function completeAssignmentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const assignmentId = String(fd.get("assignmentId") ?? "");
  const version = Number(fd.get("expectedVersion"));
  if (!assignmentId || !Number.isFinite(version)) {
    return { ok: false, code: "states.genericRetry" };
  }

  try {
    const supabase = await getServerSupabase();
    await completeAssignment(supabase, assignmentId, version);
  } catch (error) {
    return { ok: false, code: mapAssignmentError(error) };
  }

  // BOTH sides moved, and one of them belongs to somebody else: the job is
  // completed on the poster's list and the assignment is completed on the
  // installer's. Revalidating only the surface the caller is looking at would
  // leave the other party reading a stale record of their own work.
  revalidatePoster(String(fd.get("jobId") ?? ""));
  revalidateInstaller(assignmentId);
  return { ok: true, code: "work.flash.completed" };
}

/**
 * End the engagement. Either party, with a reason.
 *
 * The reason is required by the database and required here, because a
 * cancellation with no stated cause is the one outcome in this domain that
 * leaves the other party with nothing to act on. `p_reason` is theirs to read
 * afterwards on their own record.
 */
export async function cancelAssignmentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const assignmentId = String(fd.get("assignmentId") ?? "");
  const version = Number(fd.get("expectedVersion"));
  if (!assignmentId || !Number.isFinite(version)) {
    return { ok: false, code: "states.genericRetry" };
  }

  const raw = fd.get("reason");
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) return { ok: false, fieldErrors: { reason: "work.validation.reasonRequired" } };
  if (reason.length > REASON_MAX) {
    return { ok: false, fieldErrors: { reason: "work.validation.reasonTooLong" } };
  }

  try {
    const supabase = await getServerSupabase();
    await cancelAssignment(supabase, assignmentId, version, reason);
  } catch (error) {
    return { ok: false, code: mapAssignmentError(error) };
  }

  // The job returns to `open` for the poster and the assignment becomes history
  // for the installer, so both sides move whichever party called this.
  revalidatePoster(String(fd.get("jobId") ?? ""));
  revalidateInstaller(assignmentId);
  return { ok: true, code: "work.flash.cancelled" };
}
