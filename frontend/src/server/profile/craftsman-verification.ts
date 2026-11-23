import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The outcome of `craftsman_profile_verification_submit()` — the database's decision, never the browser's.
 * `submitted` / `resubmitted` mean a request now waits in Admin > Verifications; `already_open` an earlier one still
 * waits; `approved` / `rejected` are left exactly as decided (never reset, never auto-resubmitted); `incomplete` means
 * the profile is below 100%. `failed` means the call itself failed or answered nothing usable: the caller must tell the
 * user the request was NOT confirmed. `null` is only "not a Craftsman" (the database refuses the call with 42501).
 */
export type CraftsmanVerificationOutcome =
  | "submitted" | "resubmitted" | "resubmitted_after_rejection" | "already_open" | "approved" | "rejected" | "incomplete"
  | "failed";

const OUTCOMES: readonly string[] = ["submitted", "resubmitted", "resubmitted_after_rejection", "already_open", "approved", "rejected", "incomplete"];

/**
 * Ask the database to file the Craftsman's ONE professional verification request if (and only if) the authoritative
 * profile completion is 100%. Called after every write that can move the completion (saving the profile, adding a
 * portfolio project, confirming an avatar, saving the phone). It is best-effort: a failure here must never fail the
 * save that triggered it, so an error resolves to `failed` (never to a silent success). A caller that is not a
 * Craftsman is refused by the RPC (42501) and yields `null`. The RPC is idempotent, so calling it on every relevant
 * save never creates a second request. `afterRejection` is only ever true for the user pressing Resubmit.
 */
export async function submitCraftsmanVerificationIfComplete(afterRejection = false): Promise<CraftsmanVerificationOutcome | null> {
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.rpc("craftsman_profile_verification_submit", { p_after_rejection: afterRejection });
    if (error) return error.code === "42501" ? null : "failed";
    if (!data || typeof data !== "object" || Array.isArray(data)) return "failed";
    const state = (data as { state?: unknown }).state;
    return typeof state === "string" && OUTCOMES.includes(state) ? (state as CraftsmanVerificationOutcome) : "failed";
  } catch {
    return "failed";
  }
}
