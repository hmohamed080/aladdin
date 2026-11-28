import "server-only";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { DEVICE_COOKIE, isUuid } from "@/lib/auth/known-device";

export type MySession = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  isCurrent: boolean;
};

export type MyDevice = {
  deviceId: string;
  userAgent: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

/** The caller's own live sessions, the current one first (RPC is scoped to auth.uid()). */
export async function loadMySessions(): Promise<MySession[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_active_sessions");
  if (error || !data) return [];
  return data.map((s) => ({
    id: s.id,
    userAgent: s.user_agent,
    ip: s.ip,
    createdAt: s.created_at,
    lastActiveAt: s.last_active_at,
    isCurrent: s.is_current,
  }));
}

/** The caller's known devices (RLS: own rows only), most recently seen first. */
export async function loadMyDevices(): Promise<MyDevice[]> {
  const supabase = await getServerSupabase();
  const current = (await cookies()).get(DEVICE_COOKIE)?.value;
  const { data, error } = await supabase
    .from("known_devices")
    .select("device_id, user_agent, first_seen_at, last_seen_at")
    .order("last_seen_at", { ascending: false });
  if (error || !data) return [];
  return data.map((d) => ({
    deviceId: d.device_id,
    userAgent: d.user_agent,
    firstSeenAt: d.first_seen_at,
    lastSeenAt: d.last_seen_at,
    isCurrent: isUuid(current) && current === d.device_id,
  }));
}
