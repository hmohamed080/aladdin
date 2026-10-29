import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeNext } from "@/server/auth/next";
import { resolveActiveLanding } from "@/server/queries/landing";
import { accountBasicsPath, needsAccountBasics } from "@/server/queries/account-basics";
import { hasAppAccess, type RegistrationState } from "@/server/queries/registration";
import type { Database } from "@/types/database.types";

/**
 * Where a person who just got a session (Google/Facebook callback) goes next —
 * the SAME post-session rule as the email sign-in (verifyEmailOtp): `next` is
 * re-validated server-side (sanitizeNext: same-origin allow-list, never
 * `//host` or an absolute URL), onboarding/invitation continuations keep their
 * handoff, everything else passes the registration gate, and a deep link
 * survives only when it belongs to the caller's own landing surface.
 */
export async function entryLandingPath(supabase: SupabaseClient<Database>, rawNext: unknown): Promise<string> {
  const next = sanitizeNext(rawNext);
  if (next.startsWith("/onboarding") || next.startsWith("/auth/invite/")) return next;
  const { data: state } = await supabase.rpc("my_registration_state");
  if (!hasAppAccess(state as RegistrationState)) return "/onboarding";
  const landing = await resolveActiveLanding(supabase);
  const destination = next === landing || next.startsWith(`${landing}/`) ? next : landing;
  // Phone, location and specialties are asked once, for every account (ADR-0026).
  return (await needsAccountBasics(supabase)) ? accountBasicsPath(destination) : destination;
}
