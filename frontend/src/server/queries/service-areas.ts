import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The caller's own SERVICE AREAS and AVAILABILITY WINDOWS — the two authorities Overall Match reads about "where" and
 * "when". Both are the canonical tables (`user_service_areas`, `user_availability_windows`), not the onboarding
 * columns they are kept in step with.
 *
 * NEITHER TAKES A USER ID: Row Level Security restricts both tables to `auth.uid()`, so passing someone else's id
 * would return nothing rather than their data. Another person's areas and dates are never exposed.
 */

export type MyServiceAreas = {
  /** The catalogue governorate key the caller is based in, or null when none is declared. */
  primaryGovernorate: string | null;
  /** Cities the caller covers INSIDE the primary governorate (never `other`). */
  primaryCities: string[];
  /** Other areas: a governorate (city null = the whole governorate) or one city inside it. */
  others: { governorateKey: string; cityKey: string | null }[];
};

export const loadMyServiceAreas = cache(async function loadMyServiceAreas(): Promise<MyServiceAreas> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_service_areas")
    .select("governorate_key, city_key, is_primary")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const primary = rows.find((row) => row.is_primary)?.governorate_key ?? null;
  return {
    primaryGovernorate: primary,
    primaryCities: rows.filter((row) => primary && row.governorate_key === primary && row.city_key && row.city_key !== "other").map((row) => row.city_key as string),
    others: rows
      .filter((row) => !row.is_primary && (!primary || row.governorate_key !== primary))
      .map((row) => ({ governorateKey: row.governorate_key, cityKey: row.city_key })),
  };
});

export type AvailabilityWindow = { id: string; from: string; to: string | null };

export const loadMyAvailabilityWindows = cache(async function loadMyAvailabilityWindows(): Promise<AvailabilityWindow[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("user_availability_windows")
    .select("id, available_from, available_to")
    .order("available_from", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, from: row.available_from, to: row.available_to }));
});
