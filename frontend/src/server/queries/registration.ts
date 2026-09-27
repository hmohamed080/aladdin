import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The registration / access state, derived server-side (never client state) —
 * mirrors the `my_registration_state()` RPC exactly (Staging-prep Increment 7,
 * `supabase/migrations/20260924090007_registration_state_access_ready.sql`).
 *
 * `active_personal` keeps its ORIGINAL, narrower, tested meaning unchanged: a
 * real active organization membership, or `users.status = 'active'` via
 * `app.activate_personal_account()` (which never fires for the business
 * track). `access_ready` is a NEW, additive terminal state: authentication is
 * complete (confirmed email + consent + an approved top-level account type +
 * a valid stored username), independent of profile completeness or whether
 * an organization exists yet. Both states mean "may enter the app" — see
 * `hasAppAccess` below, which every gate should call instead of comparing to
 * `"active_personal"` directly.
 *
 * `username_pending` is a NEW, narrower state between `account_type_pending`
 * and `access_ready` — the RPC no longer returns `profile_pending`,
 * `contact_pending`, or any track-specific sub-state (consumer/persona/
 * organization-setup/invitation); that informational value now lives in the
 * non-gating `my_profile_completion()` RPC instead.
 */
export type RegistrationState =
  | "unverified"
  | "consent_pending"
  | "account_type_pending"
  | "username_pending"
  | "active_personal"
  | "access_ready"
  | "manually_blocked";

const KNOWN: readonly RegistrationState[] = [
  "unverified",
  "consent_pending",
  "account_type_pending",
  "username_pending",
  "active_personal",
  "access_ready",
  "manually_blocked",
];

/**
 * True for every state that means "authentication is complete — may enter
 * the app." Every consumer that used to compare `state !== "active_personal"`
 * should call `!hasAppAccess(state)` instead — see
 * `docs/frontend/auth-password-preview.md` and the staging-prep plan's
 * §2/commit-B for the full list of updated call sites. Does NOT imply an
 * active organization membership or any profile completeness — those remain
 * separately enforced (membership/capability checks for `/b2b`,
 * `my_profile_completion()` for the persistent "Complete your profile" UI).
 */
export function hasAppAccess(state: RegistrationState): boolean {
  return state === "active_personal" || state === "access_ready";
}

export async function getRegistrationState(): Promise<RegistrationState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unverified";

  const { data, error } = await supabase.rpc("my_registration_state");
  if (error || typeof data !== "string" || !KNOWN.includes(data as RegistrationState)) {
    // Verified but indeterminate — safest resume point is "we don't yet know
    // your account type," the earliest state that still exists in the new
    // model.
    return "account_type_pending";
  }
  return data as RegistrationState;
}
