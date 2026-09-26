import "server-only";

import { cache } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type PersonaType = Database["public"]["Enums"]["persona_type"];
type OrganizationType = Database["public"]["Enums"]["organization_type"];

/**
 * The org/persona subtype vocabulary (`public.activities`, Increment 3) and a
 * caller's own selection — the same two-sided split `trades.ts` uses. Inactive
 * rows are withheld by RLS (`activities_select_active`), not filtered here, so
 * a retired key cannot be offered as a new choice even by accident.
 */

/** Active activity keys for one persona, in the table's own sort order. */
export const loadPersonaActivityCatalog = cache(async function loadPersonaActivityCatalog(
  persona: PersonaType,
): Promise<string[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activities")
    .select("key")
    .eq("persona_type", persona)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.key);
});

/** Active activity keys for one organization type, in the table's own sort order. */
export const loadOrganizationActivityCatalog = cache(async function loadOrganizationActivityCatalog(
  orgType: OrganizationType,
): Promise<string[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("activities")
    .select("key")
    .eq("organization_type", orgType)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.key);
});

/** The caller's own persona-scoped activity keys (RLS: `user_activities_select_own`). */
export const loadMyActivities = cache(async function loadMyActivities(): Promise<string[]> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("user_activities")
    .select("activities!inner(key)")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []).map((r) => r.activities.key);
});

/** An organization's activity keys (RLS: active members only). */
export const loadOrganizationActivities = cache(async function loadOrganizationActivities(
  organizationId: string,
): Promise<string[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("organization_activities")
    .select("activities!inner(key)")
    .eq("organization_id", organizationId);
  if (error) throw error;
  return (data ?? []).map((r) => r.activities.key);
});
