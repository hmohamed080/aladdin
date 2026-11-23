"use server";

import { revalidatePath } from "next/cache";
import { submitCraftsmanVerificationIfComplete, type CraftsmanVerificationOutcome } from "@/server/profile/craftsman-verification";

/**
 * The Craftsman's manual retry / resubmit on `/home/profile`. It calls the SAME idempotent database function as the
 * automatic path; `afterRejection` is the only difference (the user pressing Resubmit). The database decides whether
 * the profile is 100% complete and whether a request may be filed, so a stale page or a repeated press can neither
 * file a second request nor reopen a decided one. A failed call is reported as `failed`, never as a success.
 */
export async function requestCraftsmanVerificationAction(
  afterRejection: boolean,
): Promise<{ outcome: CraftsmanVerificationOutcome | "failed" }> {
  const outcome = await submitCraftsmanVerificationIfComplete(afterRejection === true);
  revalidatePath("/home/profile");
  revalidatePath("/home", "layout");
  return { outcome: outcome ?? "failed" };
}
