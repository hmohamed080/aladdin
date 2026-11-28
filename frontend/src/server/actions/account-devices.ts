"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/known-device";

/**
 * Settings → Privacy & security: end another session, end all other sessions,
 * remove a known device. Every one runs as the caller; the database functions
 * only ever touch the caller's own sessions and devices, and never the current
 * session (the person signs out of it normally).
 */

const refresh = () => revalidatePath("/home/settings");

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const id = formData.get("sessionId");
  if (!isUuid(id)) return;
  const supabase = await getServerSupabase();
  await supabase.rpc("revoke_my_session", { p_session_id: id });
  refresh();
}

export async function signOutOtherSessionsAction(): Promise<void> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut({ scope: "others" });
  refresh();
}

export async function forgetDeviceAction(formData: FormData): Promise<void> {
  const id = formData.get("deviceId");
  if (!isUuid(id)) return;
  const supabase = await getServerSupabase();
  await supabase.rpc("forget_known_device", { p_device_id: id });
  refresh();
}
