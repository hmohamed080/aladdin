"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The identity fields every audience shares — display name, phone, avatar —
 * added by staging-prep Increments 2/5/8. Each write goes through the single
 * RPC that owns it (`profile_set_display_name` / `profile_set_phone` /
 * `avatar_request_upload` + `avatar_confirm_upload`); this file decides
 * nothing beyond translating FormData into that call and the result into a
 * translation key, the same shape `trades.ts` uses for `user_trades_set`.
 */

export type IdentityFieldState = { ok: boolean; code?: string };

const REVALIDATE_PATHS = ["/home", "/home/settings", "/home/profile", "/home/profile/edit"] as const;

function revalidateIdentity() {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
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

export type AvatarUploadTicket =
  | { ok: true; key: string }
  | { ok: false; code: string };

/** Step 1 — creates the pending metadata row and returns the server-generated key the client must upload to. */
export async function requestAvatarUploadAction(contentType: string): Promise<AvatarUploadTicket> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("avatar_request_upload", { p_content_type: contentType });
  if (error || !data) {
    return { ok: false, code: "profileIdentity.avatar.errorUpload" };
  }
  return { ok: true, key: data };
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
    await supabase.storage.from("avatars").remove([previousKey]);
  }

  revalidateIdentity();
  return { ok: true };
}

/** Step 1 of the cover upload — pending metadata row + server-generated key (mirrors the avatar flow). */
export async function requestCoverUploadAction(contentType: string): Promise<AvatarUploadTicket> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("cover_request_upload", { p_content_type: contentType });
  if (error || !data) {
    return { ok: false, code: "profileIdentity.cover.errorUpload" };
  }
  return { ok: true, key: data };
}

/** Step 3 — flips the uploaded cover to ready, points profiles.cover_media_id at it, then best-effort removes the previous object. */
export async function confirmCoverUploadAction(objectKey: string): Promise<AvatarConfirmResult> {
  const supabase = await getServerSupabase();
  const { data: previousKey, error } = await supabase.rpc("cover_confirm_upload", {
    p_object_key: objectKey,
  });
  if (error) {
    return { ok: false, code: "profileIdentity.cover.errorUpload" };
  }
  if (previousKey) {
    // Best-effort: the confirm already committed; a failure only orphans one
    // object in a private bucket only its owner could read.
    await supabase.storage.from("covers").remove([previousKey]);
  }
  revalidateIdentity();
  return { ok: true };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Birth date and gender — both optional; an empty field clears the stored value. */
export async function setPersonalDetailsAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  const birthDate = String(fd.get("birthDate") ?? "").trim();
  const gender = String(fd.get("gender") ?? "").trim();
  if (birthDate && !ISO_DATE.test(birthDate)) return { ok: false, code: "profileIdentity.personal.invalidDate" };
  if (gender && gender !== "female" && gender !== "male") return { ok: false, code: "profileIdentity.personal.error" };

  const supabase = await getServerSupabase();
  // The generated arg types are `string` (no nullability in codegen); the RPC takes NULL to clear a value.
  const { error } = await supabase.rpc("profile_set_personal_details", {
    p_birth_date: (birthDate || null) as unknown as string,
    p_gender: (gender || null) as unknown as string,
  });

  if (error) {
    return { ok: false, code: error.code === "22023" ? "profileIdentity.personal.invalidDate" : "profileIdentity.personal.error" };
  }
  revalidateIdentity();
  return { ok: true };
}

/** Username change: the shape/reserved/taken rules live in `profile_set_username`; a taken and a reserved name answer identically. */
export async function setUsernameAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  const username = String(fd.get("username") ?? "").trim();
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("profile_set_username", { p_username: username });
  if (error) {
    return { ok: false, code: error.code === "23505" ? "profileIdentity.username.unavailable" : "profileIdentity.username.invalid" };
  }
  revalidateIdentity();
  return { ok: true };
}
