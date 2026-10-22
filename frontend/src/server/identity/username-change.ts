import type { SupabaseClient } from "@supabase/supabase-js";
import { isUsernameWellFormed } from "@/lib/identity/username";
import type { Database } from "@/types/database.types";

/**
 * Editing the caller's OWN username - a thin, testable layer over the database authority `public.profile_set_username`.
 *
 * The database owns every rule: shape and length (`ck_profiles_username_*`), case-insensitive global uniqueness
 * (`uq_profiles_username_normalized`), the reserved list, and which row is written (`auth.uid()` - there is no user id
 * argument, so one account cannot rename another). This module adds only (a) an early shape check for fast feedback and
 * (b) the response contract: a translation key, never a database message, and - on success - the username as it was
 * ACTUALLY STORED, read back from the caller's own profile row.
 *
 * Anti-enumeration: "reserved" and "taken" are the same `23505` in the database and the same answer here.
 * Nothing here is a cooldown, a reservation or a history (none exists in this batch).
 */
export type UsernameResult = { ok: true; username: string } | { ok: false; code: string };

export const USERNAME_CODES = {
  required: "registration.error.usernameRequired",
  shape: "registration.error.usernameShape",
  unavailable: "registration.error.usernameUnavailable",
  sessionExpired: "installerSecurity.error.sessionExpired",
  failed: "profileIdentity.username.error",
} as const;

export async function changeUsername(supabase: SupabaseClient<Database>, raw: unknown): Promise<UsernameResult> {
  const username = typeof raw === "string" ? raw.trim() : "";
  if (username.length === 0) return { ok: false, code: USERNAME_CODES.required };
  if (!isUsernameWellFormed(username)) return { ok: false, code: USERNAME_CODES.shape };

  // The trusted session decides who is renamed. No identity is ever read from the request.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: USERNAME_CODES.sessionExpired };

  const { error } = await supabase.rpc("profile_set_username", { p_username: username });
  if (error) {
    if (error.code === "42501") return { ok: false, code: USERNAME_CODES.sessionExpired };
    if (error.code === "22023") return { ok: false, code: USERNAME_CODES.shape };
    if (error.code === "23505") return { ok: false, code: USERNAME_CODES.unavailable }; // reserved and taken look alike
    console.error(`username change failed (code ${error.code ?? "unknown"})`);
    return { ok: false, code: USERNAME_CODES.failed };
  }

  // Report what is really stored (RLS: the caller's own row). Success is never claimed from the write alone.
  const { data: stored, error: readError } = await supabase.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  if (readError || !stored?.username) {
    console.error(`username change: read-back failed (code ${readError?.code ?? "no-row"})`);
    return { ok: false, code: USERNAME_CODES.failed };
  }
  return { ok: true, username: stored.username };
}
