"use server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
export type UnavailablePeriod = { id: string; from: string; to: string | null };
export async function loadUnavailablePeriods(): Promise<UnavailablePeriod[]> {
  const db = await getServerSupabase();
  const { data, error } = await db.rpc("my_unavailable_periods" as never);
  if (error) throw error;
  return data as unknown as UnavailablePeriod[];
}
export async function saveUnavailablePeriod(_previous: { ok: boolean }, form: FormData): Promise<{ ok: boolean }> {
  const from = String(form.get("from") ?? "");
  const to = form.get("openEnded") === "1" ? null : String(form.get("to") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (to !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from))) return { ok: false };
  const db = await getServerSupabase();
  const { error } = await db.rpc("set_unavailable_period" as never, { p_from: from, p_to: to } as never);
  if (error) return { ok: false };
  revalidatePath("/home", "layout");
  return { ok: true };
}
export async function deleteUnavailablePeriod(id: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  const db = await getServerSupabase();
  const { error } = await db.rpc("remove_unavailable_period" as never, { p_id: id } as never);
  if (error) return { ok: false };
  revalidatePath("/home", "layout");
  return { ok: true };
}
