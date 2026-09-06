"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Setting your own availability (§8).
 *
 * THIS FILE DECIDES NOTHING. It writes one boolean to the caller's own row and
 * forwards whatever the database says. Every rule that matters lives there:
 *
 *   * WHICH ROW — `profiles_update_self` restricts the row to its owner, so the
 *     `eq("user_id", …)` below is a filter, not a permission. Passing someone
 *     else's id would match no row rather than write theirs.
 *   * WHO MAY — `app.stamp_availability` refuses a non-professional identity
 *     (42501). A consumer reaching this action gets the same refusal a consumer
 *     reaching the column by any other route gets.
 *   * WHEN IT CHANGED — the same trigger stamps `availability_updated_at`. It is
 *     not in the client's update grant and is deliberately not written here: a
 *     freshness signal a caller can supply is worth less than none, because the
 *     whole point of keeping the timestamp (O3) is that a reader can weigh the
 *     claim's age themselves.
 *
 * So there is no RPC. The narrow column grant IS the write path, which is what
 * §8.1 specifies, and adding a security-definer wrapper over a single boolean
 * would move the rule further from the column without making it stricter.
 */
export type AvailabilityState = { ok: boolean; code?: string };

export async function setAvailabilityAction(
  _prev: AvailabilityState,
  fd: FormData,
): Promise<AvailabilityState> {
  // The form posts the value it wants, not a toggle instruction. Two clicks that
  // race therefore converge on a value rather than swapping the state twice.
  const available = fd.get("available") === "1";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "states.genericRetry" };

  const { error } = await supabase
    .from("profiles")
    .update({ available_for_work: available })
    .eq("user_id", user.id);

  if (error) {
    // 42501 is the trigger refusing a non-professional identity. It is the one
    // failure with a meaning worth showing; anything else is a retry.
    return {
      ok: false,
      code: error.code === "42501" ? "profile.availability.notProfessional" : "states.genericRetry",
    };
  }

  // The hub renders the control, and the public page renders the result.
  revalidatePath("/home/profile");
  revalidatePath("/home");
  return { ok: true };
}
