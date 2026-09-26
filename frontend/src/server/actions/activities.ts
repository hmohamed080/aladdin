"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Whole-set writes for the org/persona subtype vocabulary. Every rule lives in
 * the RPCs (`user_activities_set` / `organization_activities_set`): the caller
 * is `auth.uid()`, an unknown or inactive-for-this-audience key refuses the
 * ENTIRE write (22023), and an organization write needs `org.manage` (42501).
 * This file only forwards the complete selection and maps the outcome to a key.
 */
export type ActivitiesState = { ok: boolean; code?: string };

function keysFrom(fd: FormData): string[] {
  return String(fd.get("keys") ?? "")
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);
}

function codeFor(errorCode: string | undefined): string {
  if (errorCode === "42501") return "profileActivities.notAllowed";
  if (errorCode === "22023") return "profileActivities.unavailable";
  return "profileActivities.saveFailed";
}

export async function setMyActivitiesAction(_prev: ActivitiesState, fd: FormData): Promise<ActivitiesState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("user_activities_set", { p_activity_keys: keysFrom(fd) });
  if (error) return { ok: false, code: codeFor(error.code) };
  revalidatePath("/home");
  revalidatePath("/home/settings");
  revalidatePath("/home/profile/edit");
  return { ok: true };
}

export async function setOrganizationActivitiesAction(_prev: ActivitiesState, fd: FormData): Promise<ActivitiesState> {
  const orgId = String(fd.get("orgId") ?? "").trim();
  if (!orgId) return { ok: false, code: "profileActivities.saveFailed" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_activities_set", {
    p_org_id: orgId,
    p_activity_keys: keysFrom(fd),
  });
  if (error) return { ok: false, code: codeFor(error.code) };
  revalidatePath("/b2b/settings");
  revalidatePath("/home");
  return { ok: true };
}
