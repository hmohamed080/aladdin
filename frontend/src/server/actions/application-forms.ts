"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { submitApplication, withdrawApplication } from "@/server/actions/jobs";
import { mapApplicationError } from "@/server/actions/error-mapping";
import type { FormState } from "@/server/actions/job-forms";

/**
 * Server Actions the installer's Apply and Withdraw controls bind to.
 *
 * NO AUTHORIZATION DECISION IS MADE HERE, and there is barely any validation
 * either — the only thing a person can fix before a round trip is the length of
 * their note, and even that the database enforces (`ck_job_app_note_len`).
 * Everything else is a lifecycle question with one authoritative answer:
 * whether the job is still open, whether the poster is still verified, whether
 * this account is a professional, whether a withdrawn candidacy may come back.
 * All four live in `job_application_submit`, and this layer's job is to carry
 * the caller's JWT to it and turn the refusal into a sentence.
 *
 * NOTHING IS OPTIMISTIC. Neither action reports success before the RPC has
 * returned, and both revalidate the surfaces whose state actually changed rather
 * than patching a local copy — an "Applied" badge that appears before the
 * database agrees is a lie the next page load corrects.
 */

const NOTE_MAX = 1000;

/**
 * Apply, or send a withdrawn candidacy again.
 *
 * ONE action for both, because the database has one path for both: submitting
 * against a withdrawn row returns that same row to `submitted`. A separate
 * "reapply" action would be a second caller of the same RPC with the same
 * arguments, kept in step by hand.
 */
export async function applyToJobAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const jobId = String(fd.get("jobId") ?? "");
  if (!jobId) return { ok: false, code: "states.genericRetry" };

  const raw = fd.get("note");
  const note = typeof raw === "string" ? raw.trim() : "";
  if (note.length > NOTE_MAX) {
    return { ok: false, fieldErrors: { note: "jobs.validation.noteTooLong" } };
  }

  try {
    const supabase = await getServerSupabase();
    await submitApplication(supabase, jobId, note || undefined);
  } catch (error) {
    return { ok: false, code: mapApplicationError(error) };
  }

  // Both surfaces move: the opportunity now reads as applied, and the candidacy
  // now exists on the tracking page.
  revalidatePath("/home/jobs");
  revalidatePath(`/home/jobs/${jobId}`);
  revalidatePath("/home/jobs/applications");
  return { ok: true, code: "jobs.installerFlash.applied" };
}

export async function withdrawApplicationAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const applicationId = String(fd.get("applicationId") ?? "");
  const jobId = String(fd.get("jobId") ?? "");
  if (!applicationId) return { ok: false, code: "states.genericRetry" };

  try {
    const supabase = await getServerSupabase();
    await withdrawApplication(supabase, applicationId);
  } catch (error) {
    return { ok: false, code: mapApplicationError(error) };
  }

  revalidatePath("/home/jobs");
  if (jobId) revalidatePath(`/home/jobs/${jobId}`);
  revalidatePath("/home/jobs/applications");
  return { ok: true, code: "jobs.installerFlash.withdrawn" };
}
