/**
 * AVAILABILITY IS A THREE-STATE FACT — and the third state is not a kind of "no".
 *
 * `profiles.available_for_work` is `NOT NULL DEFAULT false`, so the boolean alone cannot tell "I said I am not
 * taking work" from "I have never said". The database keeps the answer in `availability_updated_at`
 * (supabase/migrations/20261007090003): it is stamped when the person DECLARES availability — including the first
 * explicit "unavailable" — and is NULL until then.
 *
 *   available_for_work = true                                  -> "available"    (a true can only be a choice)
 *   false, availability_updated_at set                         -> "unavailable"  (explicitly declared)
 *   false, availability_updated_at NULL                        -> "unknown"      (the default nobody touched)
 *
 * This is the ONE place the frontend derives the state. Nothing may infer "unavailable" from `false` alone.
 */
export type AvailabilityState = "available" | "unavailable" | "unknown";

export function availabilityState(availableForWork: boolean, declaredAt: string | null | undefined): AvailabilityState {
  if (availableForWork) return "available";
  return declaredAt ? "unavailable" : "unknown";
}
