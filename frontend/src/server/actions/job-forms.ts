"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import * as jobs from "@/server/actions/jobs";
import { mapJobError } from "@/server/actions/error-mapping";

/**
 * Server Actions the organization Jobs forms bind to.
 *
 * They translate FormData → the typed RPC wrappers and map the database's
 * outcome to a translation KEY. NO AUTHORIZATION DECISION IS MADE HERE. The
 * pages hide actions a caller cannot take, but that is an affordance and not a
 * gate: every one of these calls reaches an RPC that re-checks the same rule,
 * and a caller who forges a request gets the same refusal a button would have
 * prevented them from asking for.
 *
 * Field validation IS done here, and only for the things a person can fix before
 * a round trip — a missing title, an empty trade, a non-positive amount. Nothing
 * here validates a LIFECYCLE rule: "can this job still be edited" is a question
 * with one authoritative answer and it is not in this process.
 */

export type FormState = {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
};

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function num(fd: FormData, key: string): number | undefined {
  const v = str(fd, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function int(fd: FormData, key: string): number | undefined {
  const n = num(fd, key);
  return n === undefined ? undefined : Math.trunc(n);
}

/** The content fields shared by create and edit, validated once. */
function readContent(fd: FormData) {
  const title = str(fd, "title");
  const tradeKey = str(fd, "tradeKey");
  const offeredAmount = num(fd, "offeredAmount");
  const startsOn = str(fd, "startsOn");
  const endsBy = str(fd, "endsBy");

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "jobs.validation.titleRequired";
  if (!tradeKey) fieldErrors.tradeKey = "jobs.validation.tradeRequired";
  if (offeredAmount === undefined) fieldErrors.offeredAmount = "jobs.validation.offerRequired";
  else if (offeredAmount <= 0) fieldErrors.offeredAmount = "jobs.validation.offerPositive";
  // The database enforces this too (`ck_jobs_date_order`). Checking it here as
  // well is not duplicated authority — it is the difference between a field
  // error next to the date and a generic failure after a round trip.
  if (startsOn && endsBy && endsBy < startsOn) fieldErrors.endsBy = "jobs.validation.dateOrder";

  return {
    fieldErrors,
    values: {
      title: title!,
      tradeKey: tradeKey!,
      offeredAmount: offeredAmount!,
      description: str(fd, "description"),
      governorate: str(fd, "governorate"),
      city: str(fd, "city"),
      siteAddress: str(fd, "siteAddress"),
      expectedDurationDays: int(fd, "expectedDurationDays"),
      startsOn,
      endsBy,
    },
  };
}

/**
 * Create — always a DRAFT. There is no publish-on-create path, and adding one
 * would make the irreversible half of posting a job (it becomes visible, and the
 * offer freezes on first application) a side effect of filling in a form.
 */
export async function createJobAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  if (!orgId) return { ok: false, code: "states.genericRetry" };
  const { fieldErrors, values } = readContent(fd);
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const supabase = await getServerSupabase();
  let newId: string;
  try {
    newId = await jobs.createJob(supabase, { orgId, branchId: str(fd, "branchId"), ...values });
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath("/b2b/jobs");
  redirect(`/b2b/jobs/${newId}?created=1`);
}

export async function updateJobAction(_p: FormState, fd: FormData): Promise<FormState> {
  const jobId = str(fd, "jobId");
  const expectedVersion = int(fd, "expectedVersion");
  if (!jobId || expectedVersion === undefined) return { ok: false, code: "states.genericRetry" };
  const { fieldErrors, values } = readContent(fd);
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const supabase = await getServerSupabase();
  try {
    await jobs.updateJob(supabase, { jobId, expectedVersion, ...values });
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}`);
  revalidatePath("/b2b/jobs");
  redirect(`/b2b/jobs/${jobId}?saved=1`);
}

export async function publishJobAction(_p: FormState, fd: FormData): Promise<FormState> {
  const jobId = str(fd, "jobId");
  const expectedVersion = int(fd, "expectedVersion");
  if (!jobId || expectedVersion === undefined) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    await jobs.publishJob(supabase, jobId, expectedVersion);
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}`);
  revalidatePath("/b2b/jobs");
  return { ok: true, code: "jobs.flash.published" };
}

export async function closeJobAction(_p: FormState, fd: FormData): Promise<FormState> {
  const jobId = str(fd, "jobId");
  const expectedVersion = int(fd, "expectedVersion");
  if (!jobId || expectedVersion === undefined) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    await jobs.closeJob(supabase, jobId, expectedVersion);
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}`);
  revalidatePath("/b2b/jobs");
  return { ok: true, code: "jobs.flash.closed" };
}

export async function cancelJobAction(_p: FormState, fd: FormData): Promise<FormState> {
  const jobId = str(fd, "jobId");
  const expectedVersion = int(fd, "expectedVersion");
  if (!jobId || expectedVersion === undefined) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    await jobs.cancelJob(supabase, jobId, expectedVersion, str(fd, "reason"));
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}`);
  revalidatePath("/b2b/jobs");
  return { ok: true, code: "jobs.flash.cancelled" };
}

/**
 * The award. ONE call.
 *
 * What this function deliberately does NOT do: reject the other applicants, note
 * the assignment, or move the job to `awarded`. All three happen inside
 * `job_application_accept`, in the same transaction as the acceptance, and doing
 * any of them here would be running part of a transaction outside it — with a
 * window in which one applicant is accepted and the rest still believe they are
 * in the running.
 */
export async function acceptApplicationAction(_p: FormState, fd: FormData): Promise<FormState> {
  const applicationId = str(fd, "applicationId");
  const jobId = str(fd, "jobId");
  if (!applicationId || !jobId) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    await jobs.acceptApplication(supabase, applicationId);
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}/applicants`);
  revalidatePath(`/b2b/jobs/${jobId}`);
  revalidatePath("/b2b/jobs");
  redirect(`/b2b/jobs/${jobId}?awarded=1`);
}

export async function rejectApplicationAction(_p: FormState, fd: FormData): Promise<FormState> {
  const applicationId = str(fd, "applicationId");
  const jobId = str(fd, "jobId");
  const reason = str(fd, "reason");
  if (!applicationId || !jobId) return { ok: false, code: "states.genericRetry" };
  // Required by the database (`ck_job_app_reject_reason`), and asked for here so
  // the person writing it sees why before they lose what they typed.
  if (!reason) return { ok: false, fieldErrors: { reason: "jobs.validation.reasonRequired" } };

  const supabase = await getServerSupabase();
  try {
    await jobs.rejectApplication(supabase, applicationId, reason);
  } catch (e) {
    return { ok: false, code: mapJobError(e) };
  }
  revalidatePath(`/b2b/jobs/${jobId}/applicants`);
  revalidatePath(`/b2b/jobs/${jobId}`);
  return { ok: true, code: "jobs.flash.rejected" };
}
