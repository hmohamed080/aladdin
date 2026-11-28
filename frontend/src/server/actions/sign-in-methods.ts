"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { isOAuthProvider } from "@/server/auth/entry-oauth";

export type UnlinkState = { ok: boolean; code?: "last" | "error" };

/**
 * Disconnects Google or Facebook from the signed-in account. The last remaining
 * way to sign in is never removed (Supabase Auth refuses it too; this check
 * gives a clear answer instead of a raw error).
 */
export async function unlinkProviderAction(_prev: UnlinkState, fd: FormData): Promise<UnlinkState> {
  const provider = String(fd.get("provider") ?? "");
  if (!isOAuthProvider(provider)) return { ok: false, code: "error" };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return { ok: false, code: "error" };
  const target = data.identities.find((identity) => identity.provider === provider);
  if (!target) return { ok: true };
  if (data.identities.length < 2) return { ok: false, code: "last" };

  const { error: unlinkError } = await supabase.auth.unlinkIdentity(target);
  if (unlinkError) return { ok: false, code: "error" };
  revalidatePath("/home/settings");
  return { ok: true };
}
