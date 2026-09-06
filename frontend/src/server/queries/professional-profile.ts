import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * The professional profile, from the two sides it is read from.
 *
 * NO NEW STORAGE. The hub renders what `loadPersonalHome` already assembles; the
 * editor writes through `individual_save_professional`, which was built
 * re-entrant precisely so it could back something other than a wizard; and the
 * public page reads the hardened `profile_public_directory` projection. The one
 * schema change behind this module (`20260831090002`) created no table, column or
 * concept — it widened that projection over columns `individual_onboarding`
 * already held. What this module adds beyond it is the caller's OWN profile id
 * and whether the platform has listed it.
 *
 * WHAT IS PUBLIC. Identity (name, headline, summary, languages, persona), the
 * canonical trades `20260901090001` added (§4.6 — active keys only, primary
 * first), plus the four practice fields `20260831090002` added — specialization, core services,
 * years of experience, service areas — plus self-declared availability and the
 * timestamp of its last change (`20260831090004`, §8.4). The private side of
 * onboarding does not come with them: `prof_availability` (the one-off LEAD-TIME
 * preference, which is a different fact from the live flag), travel radius, base
 * address, the secondary service list and every consumer answer stay in
 * `individual_onboarding`, which remains readable only by its owner.
 *
 * THE PUBLICATION BOUNDARY IS THE WHOLE POINT. `public_profile_status` is written
 * only by `apply_account_upgrade`, so a professional cannot publish themselves,
 * and the projection additionally requires a canonical persona and an active user.
 * The hub therefore reports listing as a STATE, never as a switch — and the public
 * route 404s for an unlisted profile rather than rendering a private one behind an
 * unguessable id.
 */

export type PublicProfile = {
  id: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  languages: string[];
  persona: Database["public"]["Enums"]["persona_type"] | null;
  /**
   * The self-declared PRACTICE, added to the projection in `20260831090002`.
   * Every field is nullable and independently so: a listed professional need
   * have no `individual_onboarding` row at all (the projection LEFT JOINs it),
   * and the seeded Pilot professionals are exactly that case — so the view must
   * treat "absent" as normal rather than as a broken profile.
   */
  specialization: string | null;
  services: string[];
  yearsExperience: number | null;
  serviceAreas: string[];
  /**
   * Self-declared availability, added to the projection by `20260831090004`
   * (§8.4). Shown WITH its age so a reader can weigh the claim themselves — the
   * page never decides for them, and the flag filters nothing: an unavailable
   * professional is still listed and still found.
   *
   * `availabilityUpdatedAt` is null when the person has never set availability.
   * That is a different statement from "unavailable", and the page says so.
   */
  availableForWork: boolean;
  availabilityUpdatedAt: string | null;
  /**
   * The canonical trades (Increment 5, §4.6) — ACTIVE ones only, primary first,
   * then the vocabulary's own order. Keys, not ids: the label is an i18n lookup
   * and a uuid would be an internal identifier published for no reader's
   * benefit.
   *
   * These are the STRUCTURED specialty signal and are now what the page leads
   * with. `specialization` above is the legacy free text — the same claim in a
   * vocabulary nothing can join on — and is shown only where there is no
   * canonical trade to show instead.
   *
   * An empty array is the common state and is not an error: declaring trades is
   * optional, and a professional without them is listed and findable exactly as
   * before (O5 — trades filter nothing).
   */
  tradeKeys: string[];
  primaryTradeKey: string | null;
};

/** Where the caller's own profile stands with public discovery. */
export type ProfilePublication = {
  /** `profiles.id` — the public route's parameter. Null when there is no profile row. */
  profileId: string | null;
  /** True only when the platform has listed it; never self-set. */
  listed: boolean;
};

/**
 * The caller's own publication state.
 *
 * `cache()`d per render: the hub reads it, and so does the header action beside
 * it. Reading `profiles` directly is safe and deliberate — `profiles_select_self`
 * restricts the row to its owner, so this cannot see anyone else's.
 */
export const loadProfilePublication = cache(async function loadProfilePublication(): Promise<ProfilePublication> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { profileId: null, listed: false };

  const { data } = await supabase
    .from("profiles")
    .select("id, public_profile_status")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    profileId: data?.id ?? null,
    listed: data?.public_profile_status === "listed",
  };
});

/**
 * One public professional profile, or null when there is nothing public to show.
 *
 * Null covers three cases the caller must NOT be able to tell apart — no such
 * profile, a profile that exists but is not listed, and a listed profile whose
 * account is no longer active. They are one answer here because distinguishing
 * them would leak the existence of a private profile to anyone who could guess an
 * id, which is exactly what the projection is shaped to prevent.
 *
 * Reachable while signed out: the view grants SELECT to `anon`, and `/p/*` is not
 * in the middleware's authenticated set.
 */
export async function loadPublicProfile(profileId: string): Promise<PublicProfile | null> {
  // A malformed id is a miss, not a 500: Postgres rejects a non-uuid comparison
  // outright, and a stray link should 404 like any other unknown profile.
  if (!isUuid(profileId)) return null;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("profile_public_directory")
    .select(
      "id, display_name, headline, bio, languages, persona, specialization, services, years_experience, service_areas, available_for_work, availability_updated_at, trade_keys, primary_trade_key",
    )
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data?.id) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    headline: data.headline,
    bio: data.bio,
    languages: data.languages ?? [],
    persona: data.persona,
    specialization: data.specialization,
    services: data.services ?? [],
    yearsExperience: data.years_experience,
    serviceAreas: data.service_areas ?? [],
    availableForWork: data.available_for_work ?? false,
    availabilityUpdatedAt: data.availability_updated_at ?? null,
    tradeKeys: data.trade_keys ?? [],
    primaryTradeKey: data.primary_trade_key ?? null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exported for the test that pins the 404-not-500 behaviour on a bad id. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
