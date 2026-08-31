import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * "Is this account a SALESPERSON?" — the one frontend answer to the question the
 * Sales-affiliation flow asks, and a mirror of `app.is_sales_persona` in
 * `20260831090001_sales_affiliation_persona_hardening.sql`.
 *
 * The database is the authority: every affiliation write path refuses a non-Sales
 * persona with its own check, so nothing here grants anything. This exists so the
 * UI can say plainly *"this isn't for your account type"* instead of letting
 * someone fill in a form that the server was always going to reject.
 *
 * TWO SOURCES, and the second is required rather than generous. `users.primary_account_type`
 * is written only by the approved-and-applied upgrade workflow, so between
 * submitting a professional profile and an Admin applying it the canonical column
 * is still null — while the account is active and usable the whole time
 * (activation is not verification). `individual_onboarding.prof_concrete_type` is
 * what the person declared about themselves, and it is the same resolution
 * `loadPersonalHome` already uses to decide which home to render: *"the declared
 * type is what the account actually is, and the separate verification state says
 * how far the platform has gone in trusting the claim."*
 *
 * Reading only the canonical column would lock a genuine salesperson out of
 * connecting to their employer for the whole review window — a regression wearing
 * a security fix's clothes, and exactly what the database predicate avoids.
 */

/**
 * The rule, as a pure function so it can be tested without a database and stays
 * readable next to the SQL it mirrors.
 */
export function isSalesPersona(
  canonicalPersona: string | null | undefined,
  declaredPersona: string | null | undefined,
): boolean {
  return canonicalPersona === "sales" || declaredPersona === "sales";
}

/**
 * The caller's own answer. False for a signed-out caller — never a throw.
 *
 * `cache()`d for the duration of ONE server render, for the same reason
 * `loadWorkspaces` is: the personal layout and the page it wraps both ask this
 * question on /home/showroom, and without memoization that is two identical pairs
 * of round trips per navigation. React scopes the cache to a single render, so
 * nothing is shared across requests or across callers.
 */
export const loadIsSalesPersona = cache(async function loadIsSalesPersona(): Promise<boolean> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const [{ data: userRow }, { data: onboarding }] = await Promise.all([
    supabase.from("users").select("primary_account_type").eq("id", user.id).maybeSingle(),
    supabase
      .from("individual_onboarding")
      .select("prof_concrete_type")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return isSalesPersona(userRow?.primary_account_type, onboarding?.prof_concrete_type);
});
