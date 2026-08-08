import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The registration / resume state, derived server-side from existing tables
 * (auth session + consent receipts + users.status + memberships + onboarding
 * progress) — no stored state column. Mirrors the `my_registration_state()` RPC;
 * `unverified` when there is no session at all. Sprint 7.3 added the finer
 * onboarding step states so `/onboarding` can resolve the next incomplete step.
 */
export type RegistrationState =
  | "unverified"
  | "consent_pending"
  | "profile_pending"
  | "contact_pending"
  | "account_type_pending"
  | "consumer_onboarding_pending"
  | "consumer_onboarding_complete"
  | "persona_onboarding_pending"
  | "persona_review_pending"
  | "organization_setup_pending"
  | "invitation_pending"
  | "active_personal"
  | "manually_blocked";

const KNOWN: readonly RegistrationState[] = [
  "unverified",
  "consent_pending",
  "profile_pending",
  "contact_pending",
  "account_type_pending",
  "consumer_onboarding_pending",
  "consumer_onboarding_complete",
  "persona_onboarding_pending",
  "persona_review_pending",
  "organization_setup_pending",
  "invitation_pending",
  "active_personal",
  "manually_blocked",
];

export async function getRegistrationState(): Promise<RegistrationState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unverified";

  const { data, error } = await supabase.rpc("my_registration_state");
  if (error || typeof data !== "string" || !KNOWN.includes(data as RegistrationState)) {
    // Verified but indeterminate — safest resume point is the first onboarding step.
    return "profile_pending";
  }
  return data as RegistrationState;
}
