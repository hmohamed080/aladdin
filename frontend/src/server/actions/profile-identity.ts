"use server";

import { authorizeMediaUpload, verifyPendingMedia, removeMedia } from "@/server/storage/media";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { readPublicEnv } from "@/lib/env";
import { craftsmanLoginAlias, isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { isCanonicalPhoneTaken, rekeyLoginAlias } from "@/lib/supabase/admin-server";
import { phoneAuthLimit } from "@/server/auth/phone-auth-limit";

/**
 * The identity fields every audience shares — display name, phone, avatar —
 * added by staging-prep Increments 2/5/8. Each write goes through the single
 * RPC that owns it (`profile_set_display_name` / `profile_set_phone` /
 * `avatar_request_upload` + `avatar_confirm_upload`); this file decides
 * nothing beyond translating FormData into that call and the result into a
 * translation key, the same shape `trades.ts` uses for `user_trades_set`.
 */

export type IdentityFieldState = { ok: boolean; code?: string };

const REVALIDATE_PATHS = ["/home/settings", "/home/profile", "/home/profile/edit", "/settings/profile", "/showroom/settings", "/b2b/settings"] as const;

function revalidateIdentity() {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
  // The header shows the display name; it lives in the /home layout, which only a layout revalidation refreshes.
  revalidatePath("/home", "layout");
}

export async function setDisplayNameAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  const displayName = String(fd.get("displayName") ?? "").trim();
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("profile_set_display_name", { p_display_name: displayName });

  if (error) {
    return { ok: false, code: "profileIdentity.displayName.error" };
  }
  revalidateIdentity();
  return { ok: true };
}

export async function setPhoneAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  // The generated RPC arg type is `string` (Postgres function parameters carry
  // no nullability info for the codegen to see), even though profile_set_phone
  // accepts a genuine SQL NULL for p_country_iso2/p_national at runtime. An
  // empty string submission fails the RPC's own shape checks with a proper
  // validation error instead, which is an acceptable outcome for malformed
  // FormData that should never happen once PhoneField has produced a value.
  const countryIso2 = String(fd.get("countryIso2") ?? "").trim();
  const national = String(fd.get("national") ?? "").trim();
  const e164 = String(fd.get("e164") ?? "").trim();

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("profile_set_phone", {
    p_country_iso2: countryIso2,
    p_national: national,
    p_e164: e164,
  });

  if (error) {
    // 23505 is the RPC's own GENERIC "phone number is unavailable" — it never
    // reveals whether the collision was with another account, and neither
    // does this mapping.
    return {
      ok: false,
      code: error.code === "23505" ? "profileIdentity.phone.unavailable" : "profileIdentity.phone.error",
    };
  }
  revalidateIdentity();
  return { ok: true };
}

/**
 * Change the phone of a phone + password account. Here the phone is also the sign-in key (an internal login
 * alias derived from it), and the database refuses to move a profile phone away from its alias. So the change
 * is a re-key: prove the CURRENT password, check the new number is free, move the alias, then the profile
 * phone - and put the alias back if the profile write fails. The old number stops signing in, the new one
 * starts, and the profile (which Admin reads) carries the new number.
 */
export async function changeLoginPhoneAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  const countryIso2 = String(fd.get("countryIso2") ?? "").trim();
  const national = String(fd.get("national") ?? "").trim();
  const e164 = String(fd.get("e164") ?? "").trim();
  const password = String(fd.get("currentPassword") ?? "");
  if (!e164 || !countryIso2 || !national) return { ok: false, code: "profileIdentity.phone.error" };
  if (!password) return { ok: false, code: "profileIdentity.phone.passwordRequired" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isCraftsmanLoginAlias(user.email)) return { ok: false, code: "profileIdentity.phone.error" };
  const oldAlias = user.email!.trim().toLowerCase();

  let newAlias: string;
  try {
    newAlias = craftsmanLoginAlias(e164);
  } catch {
    return { ok: false, code: "profileIdentity.phone.error" };
  }
  if (newAlias === oldAlias) return { ok: true };

  // Password guesses are throttled exactly like a sign-in for this account.
  const limited = await phoneAuthLimit("sign-in", oldAlias, await headers());
  if (limited !== "allowed") return { ok: false, code: "profileIdentity.phone.rateLimited" };

  // Proof of the current password through a stateless client: the caller's own session cookies are untouched.
  const env = readPublicEnv();
  const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const proof = await verifier.auth.signInWithPassword({ email: oldAlias, password });
  if (proof.error) return { ok: false, code: "profileIdentity.phone.wrongPassword" };
  await verifier.auth.signOut({ scope: "local" });

  try {
    if (await isCanonicalPhoneTaken(e164)) return { ok: false, code: "profileIdentity.phone.unavailable" };
  } catch {
    return { ok: false, code: "profileIdentity.phone.error" };
  }

  const moved = await rekeyLoginAlias(user.id, newAlias);
  if (!moved.ok) {
    return { ok: false, code: moved.reason === "exists" ? "profileIdentity.phone.unavailable" : "profileIdentity.phone.error" };
  }
  const { error } = await supabase.rpc("profile_set_phone", { p_country_iso2: countryIso2, p_national: national, p_e164: e164 });
  if (error) {
    // The alias and the profile phone must agree; undo the alias move so the old number keeps working.
    const restored = await rekeyLoginAlias(user.id, oldAlias);
    if (!restored.ok) console.error("phone re-key: could not restore the previous login alias");
    return { ok: false, code: error.code === "23505" ? "profileIdentity.phone.unavailable" : "profileIdentity.phone.error" };
  }
  revalidateIdentity();
  return { ok: true };
}

export type AvatarUploadTicket =
  | { ok: true; key: string; grant: UploadGrant }
  | { ok: false; code: string };

/** Step 1 — creates the pending metadata row and returns the server-generated key the client must upload to. */
export async function requestAvatarUploadAction(contentType: string, expectedBytes?: number): Promise<AvatarUploadTicket> {
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 3 * 1024 * 1024)) {
    return { ok: false, code: "profileIdentity.avatar.errorUpload" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("avatar_request_upload", { p_content_type: contentType });
  if (error || !data) {
    return { ok: false, code: "profileIdentity.avatar.errorUpload" };
  }
  try { return { ok: true, key: data, grant: await authorizeMediaUpload(supabase, "avatar", data, expectedBytes) }; }
  catch { return { ok: false, code: "profileIdentity.avatar.errorUpload" }; }
}

export type AvatarConfirmResult = { ok: true } | { ok: false; code: string };

/**
 * Step 3 — flips the uploaded object to ready and points profiles.avatar_media_id
 * at it. Best-effort deletes the previous object (if any) using the SAME
 * server-scoped client, since `avatars_delete_own` authorizes the owner and
 * the bytes never need to touch the browser again.
 */
export async function confirmAvatarUploadAction(objectKey: string): Promise<AvatarConfirmResult> {
  const supabase = await getServerSupabase();
  try { await verifyPendingMedia(supabase, "avatar", objectKey); }
  catch { return { ok: false, code: "profileIdentity.avatar.errorUpload" }; }
  const { data: previousKey, error } = await supabase.rpc("avatar_confirm_upload", {
    p_object_key: objectKey,
  });
  if (error) {
    return { ok: false, code: "profileIdentity.avatar.errorUpload" };
  }

  if (previousKey) {
    // Best-effort: the confirm already committed, so a cleanup failure here
    // never leaves the caller's own avatar unset — it only leaves one orphaned
    // object in a private bucket nobody but the owner could ever read anyway.
    try { await removeMedia(supabase, "avatar", previousKey); } catch { /* Metadata already revoked access. */ }
  }

  revalidateIdentity();
  return { ok: true };
}

export async function deleteAvatarAction(): Promise<AvatarConfirmResult> {
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("avatar_delete_current" as never);
  if (error) return { ok: false, code: "profileIdentity.avatar.errorUpload" };
  if (typeof key === "string") {
    try { await removeMedia(supabase, "avatar", key); } catch { /* Retired metadata remains for retryable cleanup. */ }
  }
  revalidateIdentity();
  return { ok: true };
}
