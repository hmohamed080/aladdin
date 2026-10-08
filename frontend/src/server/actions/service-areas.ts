"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Saving your own SERVICE AREAS and AVAILABILITY WINDOWS.
 *
 * THIS FILE DECIDES NOTHING. Service areas go through `user_service_areas_set` (SECURITY DEFINER, `auth.uid()` only,
 * every key validated against the Egypt catalogue); availability windows are the caller's own rows under Row Level
 * Security, guarded by a trigger (professional identity only, bounded count). Whatever the database refuses is
 * reported; nothing here re-implements a rule. Neither is an authorization input anywhere — they only feed the
 * Overall Match presentation score and the Near me ordering.
 */
export type AreasState = { ok: boolean; code?: string };

const KEY = /^[a-z][a-z0-9-]{0,63}$/;

/** The form posts the COMPLETE set: one primary governorate and a JSON array of areas, so a double submit converges. */
export async function setServiceAreasAction(_prev: AreasState, fd: FormData): Promise<AreasState> {
  const primary = String(fd.get("primary") ?? "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(fd.get("areas") ?? "[]"));
  } catch {
    return { ok: false, code: "profile.serviceAreas.saveFailed" };
  }
  if (!Array.isArray(parsed) || parsed.length > 100) return { ok: false, code: "profile.serviceAreas.saveFailed" };
  const areas: { governorate_key: string; city_key: string | null }[] = [];
  for (const entry of parsed) {
    const g = typeof entry?.governorateKey === "string" ? entry.governorateKey : "";
    const c = typeof entry?.cityKey === "string" && entry.cityKey !== "" ? entry.cityKey : null;
    if (!KEY.test(g) || (c !== null && !KEY.test(c))) return { ok: false, code: "profile.serviceAreas.saveFailed" };
    areas.push({ governorate_key: g, city_key: c });
  }
  if (!primary && areas.length > 0) return { ok: false, code: "profile.serviceAreas.invalid" };
  if (primary && !KEY.test(primary)) return { ok: false, code: "profile.serviceAreas.saveFailed" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("user_service_areas_set", {
    p_primary_governorate_key: primary,
    p_areas: areas,
  });
  if (error) {
    return {
      ok: false,
      code: error.code === "42501" ? "profile.serviceAreas.notProfessional" : error.code === "22023" ? "profile.serviceAreas.invalid" : "profile.serviceAreas.saveFailed",
    };
  }
  revalidatePath("/home/profile");
  revalidatePath("/home/profile/edit");
  revalidatePath("/home");
  revalidatePath("/home/jobs");
  return { ok: true };
}

export type WindowState = { ok: boolean; code?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function addAvailabilityWindowAction(_prev: WindowState, fd: FormData): Promise<WindowState> {
  const from = String(fd.get("from") ?? "").trim();
  const openEnded = fd.get("openEnded") === "1";
  const to = openEnded ? "" : String(fd.get("to") ?? "").trim();
  if (!DAY.test(from) || (!openEnded && !DAY.test(to)) || (to && to < from)) return { ok: false, code: "profile.availabilityWindows.failed" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "states.genericRetry" };
  const { error } = await supabase
    .from("user_availability_windows")
    .insert({ user_id: user.id, available_from: from, available_to: to || null });
  if (error) {
    return { ok: false, code: error.code === "42501" ? "profile.availabilityWindows.notProfessional" : "profile.availabilityWindows.failed" };
  }
  revalidatePath("/home/settings");
  revalidatePath("/home");
  return { ok: true };
}

export async function removeAvailabilityWindowAction(id: string): Promise<WindowState> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, code: "profile.availabilityWindows.failed" };
  const supabase = await getServerSupabase();
  // RLS restricts the row to its owner: another person's id matches nothing.
  const { error } = await supabase.from("user_availability_windows").delete().eq("id", id);
  if (error) return { ok: false, code: "profile.availabilityWindows.failed" };
  revalidatePath("/home/settings");
  revalidatePath("/home");
  return { ok: true };
}
