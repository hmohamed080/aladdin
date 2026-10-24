"use server";

import { authorizeMediaUpload, verifyPendingMedia, removeMedia } from "@/server/storage/media";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { isCraftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import { SECURITY_CODES, defaultSecurityDeps, performPhoneChange } from "@/server/auth/installer-security";
import { resolveSecuritySession } from "@/server/auth/security-session";
import { changeUsername, type UsernameResult } from "@/server/identity/username-change";

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

/** The caller's own username, through `profile_set_username` (see `server/identity/username-change.ts`). Returns the stored value. */
export type UsernameFieldState = { ok: boolean; code?: string; username?: string };

export async function setUsernameAction(_prev: UsernameFieldState, fd: FormData): Promise<UsernameFieldState> {
  const supabase = await getServerSupabase();
  const result: UsernameResult = await changeUsername(supabase, fd.get("username"));
  if (!result.ok) return { ok: false, code: result.code };
  revalidateIdentity();
  return { ok: true, username: result.username };
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
 * Change the phone of a phone + password account. Here the phone is also the sign-in key (an internal login alias derived
 * from it), so the change is the JOURNALED re-key in `@/server/auth/installer-security`: PR #88's current-password
 * confirmation (one attempt budget per account) issues a receipt bound to the new number, the database moves the
 * profile and journals the change in one transaction, the Auth Admin API moves the alias, and the database settles the
 * outcome from the authoritative alias (restoring the old number if Auth never changed). The database guards on
 * profiles and auth.users refuse any unjournaled alias or phone move, so there is no other path.
 */
export async function changeLoginPhoneAction(
  _prev: IdentityFieldState,
  fd: FormData,
): Promise<IdentityFieldState> {
  const countryIso2 = String(fd.get("countryIso2") ?? "").trim();
  const national = String(fd.get("national") ?? "").trim();
  const password = String(fd.get("currentPassword") ?? "");
  if (!countryIso2 || !national) return { ok: false, code: "profileIdentity.phone.error" };
  if (!password) return { ok: false, code: "profileIdentity.phone.passwordRequired" };

  try {
    const supabase = await getServerSupabase();
    const { actor, session } = await resolveSecuritySession(supabase);
    if (!actor || !isCraftsmanLoginAlias(actor.loginEmail)) return { ok: false, code: "profileIdentity.phone.error" };
    const result = await performPhoneChange(defaultSecurityDeps(supabase), actor, session, {
      countryIso2,
      national,
      password,
      requestId: fd.get("requestId") ?? undefined,
    });
    if (result.ok || result.code === SECURITY_CODES.phoneSame) {
      revalidateIdentity();
      return { ok: true };
    }
    return { ok: false, code: LOGIN_PHONE_CODES[result.code] ?? "profileIdentity.phone.error" };
  } catch {
    console.error("phone re-key: aborted unexpectedly");
    return { ok: false, code: "profileIdentity.phone.error" };
  }
}

const LOGIN_PHONE_CODES: Record<string, string> = {
  [SECURITY_CODES.wrongPassword]: "profileIdentity.phone.wrongPassword",
  [SECURITY_CODES.passwordRequired]: "profileIdentity.phone.passwordRequired",
  [SECURITY_CODES.locked]: "profileIdentity.phone.rateLimited",
  [SECURITY_CODES.busy]: "profileIdentity.phone.rateLimited",
  [SECURITY_CODES.phoneUnavailable]: "profileIdentity.phone.unavailable",
  [SECURITY_CODES.phoneInProgress]: "profileIdentity.phone.inProgress",
  [SECURITY_CODES.phoneNotConfirmed]: "profileIdentity.phone.inProgress",
  [SECURITY_CODES.needsAttention]: "profileIdentity.phone.needsAttention",
  [SECURITY_CODES.phoneFailed]: "profileIdentity.phone.error",
  [SECURITY_CODES.phoneInvalid]: "profileIdentity.phone.error",
};

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

// ---------------------------------------------------------------------------------------------------------------
// Profile COVER image: the avatar pipeline (pending -> verified bytes -> ready -> previous deleted) with purpose cover.
// ---------------------------------------------------------------------------------------------------------------

/** Step 1 - a pending cover row and the server-generated key the browser must upload to. */
export async function requestCoverUploadAction(contentType: string, expectedBytes?: number): Promise<AvatarUploadTicket> {
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 3 * 1024 * 1024)) {
    return { ok: false, code: "profileIdentity.cover.errorUpload" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("cover_request_upload", { p_content_type: contentType });
  if (error || !data) return { ok: false, code: "profileIdentity.cover.errorUpload" };
  try { return { ok: true, key: data, grant: await authorizeMediaUpload(supabase, "avatar", data, expectedBytes) }; }
  catch { return { ok: false, code: "profileIdentity.cover.errorUpload" }; }
}

/** Step 3 - verified bytes become the current cover; the previous cover object is removed best-effort. */
export async function confirmCoverUploadAction(objectKey: string): Promise<AvatarConfirmResult> {
  const supabase = await getServerSupabase();
  try { await verifyPendingMedia(supabase, "avatar", objectKey); }
  catch { return { ok: false, code: "profileIdentity.cover.errorUpload" }; }
  const { data: previousKey, error } = await supabase.rpc("cover_confirm_upload", { p_object_key: objectKey });
  if (error) return { ok: false, code: "profileIdentity.cover.errorUpload" };
  if (previousKey) {
    try { await removeMedia(supabase, "avatar", previousKey); } catch { /* Metadata already revoked access. */ }
  }
  revalidateIdentity();
  return { ok: true };
}

export async function deleteCoverAction(): Promise<AvatarConfirmResult> {
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("cover_delete_current");
  if (error) return { ok: false, code: "profileIdentity.cover.errorUpload" };
  if (typeof key === "string") {
    try { await removeMedia(supabase, "avatar", key); } catch { /* Retired metadata remains for retryable cleanup. */ }
  }
  revalidateIdentity();
  return { ok: true };
}
