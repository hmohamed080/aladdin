"use server";

import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapAssetError } from "@/server/actions/error-mapping";
import {
  ASSET_NAMESPACES,
  ASSET_POLICY,
  ASSET_READ_URL_SECONDS,
  buildAssetKey,
  isAssetKeyOwnedBy,
  validateAssetFile,
  type AssetErrorCode,
  type AssetNamespace,
} from "@/lib/storage/professional-assets";

/**
 * The three ways a professional's file moves: in, out, and away.
 *
 * THESE ARE `"use server"` EXPORTS, so every argument below arrives from a
 * browser and none of it is trusted. In particular no function here takes an
 * owner id. The owner is always `auth.getUser()`, re-derived on every call, and
 * the object key is BUILT from it rather than checked against it — a caller
 * cannot name a folder, only be in one.
 *
 * WHY A SERVER SEAM AT ALL, when RLS would refuse a rogue browser anyway.
 * Three things it does that a direct client upload could not:
 *
 *   1. The PATH IS SERVER-DERIVED. `createAssetUploadTicket` mints a token bound
 *      to one bucket, one key and `upsert: false` — all three inside the signed
 *      token, so the browser holds an authorization to write exactly one object
 *      and cannot repoint it.
 *   2. ONE PLACE TO CHANGE. §11 asks that `createSignedUrl` not end up scattered
 *      through page components later. Increment 11 imports these three and adds
 *      none of its own.
 *   3. FAILURES BECOME SENTENCES. Storage answers `AccessDenied` / `NoSuchKey` /
 *      `EntityTooLarge`; `mapAssetError` turns those into keys a person can read,
 *      so no raw storage text reaches a screen (§18).
 *
 * WHAT IT DELIBERATELY IS NOT is the enforcement point. Everything here is
 * checked again by the database and the Storage service — service-role is never
 * used, and every call runs as the caller's own identity, so a bug in this file
 * widens nothing. That is the property worth keeping: the seam is for ergonomics
 * and error quality, and the boundary is somewhere a caller cannot reach.
 */

export type AssetTicket =
  | {
      readonly ok: true;
      /** Storage bucket the token is bound to. */
      readonly bucket: string;
      /** `<owner>/<object-id>.<ext>` — derived here, never supplied. */
      readonly path: string;
      /** Single-use, single-path signed upload token. */
      readonly token: string;
    }
  | { readonly ok: false; readonly code: AssetErrorCode };

export type AssetUrl =
  | { readonly ok: true; readonly url: string; readonly expiresIn: number }
  | { readonly ok: false; readonly code: AssetErrorCode };

export type AssetResult = { readonly ok: true } | { readonly ok: false; readonly code: AssetErrorCode };

/** A browser can send any string; only these two mean anything. */
function readNamespace(value: string): AssetNamespace | null {
  return (ASSET_NAMESPACES as readonly string[]).includes(value)
    ? (value as AssetNamespace)
    : null;
}

/**
 * Upload authority.
 *
 * The persona gate is NOT re-implemented here. Minting the token is itself an
 * authorized write — Storage evaluates the INSERT policy before it will sign
 * anything — so a consumer, a business-only identity or a downgraded
 * professional is refused at this call, by `app.can_create_professional_asset`,
 * with no code in this file consulting a persona at all. Verified over HTTP in
 * `supabase/tests/professional_asset_storage_api_test.mjs`.
 *
 * Type and size are checked first, only so the refusal is immediate and specific.
 * The bucket refuses both again regardless.
 */
export async function createAssetUploadTicket(
  namespace: string,
  file: { type: string; size: number },
): Promise<AssetTicket> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const valid = validateAssetFile(ns, file);
  if (!valid.ok) return { ok: false, code: valid.code };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "assets.errors.notAllowed" };

  // The only place an object identity is created. A fresh uuid per ticket is
  // what makes keys immutable in practice as well as in policy: nothing a caller
  // sends can steer this at an existing object.
  const path = buildAssetKey(user.id, randomUUID(), file.type);

  const { data, error } = await supabase.storage
    .from(ASSET_POLICY[ns].bucket)
    .createSignedUploadUrl(path);

  if (error || !data) return { ok: false, code: mapAssetError(error) };
  return { ok: true, bucket: ASSET_POLICY[ns].bucket, path, token: data.token };
}

/**
 * Read authority (§11).
 *
 * Short-lived, minted per object, and refused for anything the caller does not
 * own — twice. The ownership check below is a fast, specific refusal; the
 * SELECT policy is the one that counts, and it hides the row so completely that
 * Storage answers `NoSuchKey` rather than "denied". A caller therefore cannot
 * learn whether someone else's object exists by asking for it.
 *
 * There is no variant that takes a bucket. §11 warns against a helper that
 * accepts an arbitrary bucket/object pair, so the namespace is a closed set of
 * two and the bucket is looked up rather than passed.
 */
export async function createAssetReadUrl(namespace: string, path: string): Promise<AssetUrl> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "assets.errors.notAllowed" };

  if (!isAssetKeyOwnedBy(path, user.id)) return { ok: false, code: "assets.errors.invalidPath" };

  const { data, error } = await supabase.storage
    .from(ASSET_POLICY[ns].bucket)
    .createSignedUrl(path, ASSET_READ_URL_SECONDS);

  if (error || !data?.signedUrl) return { ok: false, code: mapAssetError(error) };
  return { ok: true, url: data.signedUrl, expiresIn: ASSET_READ_URL_SECONDS };
}

/**
 * Delete authority (§12).
 *
 * One object, named in full, belonging to the caller. There is no folder form
 * and no wildcard, because the argument that would enable a bulk delete is the
 * same argument that would enable someone else's.
 *
 * IDEMPOTENT BY DESIGN. `NoSuchKey` is folded into success: the caller asked for
 * the object to be gone and it is gone, and a second click on a delete button
 * should not produce an error about a file that is already removed. It matters
 * for Increment 11 specifically — when a metadata row and an object have to be
 * cleaned up together, a retry after a partial failure has to be able to
 * converge instead of jamming on the half that already succeeded.
 *
 * The persona gate is absent here, and that absence is the downgrade contract:
 * someone who stops being a professional can always remove their own data.
 */
export async function deleteProfessionalAsset(
  namespace: string,
  path: string,
): Promise<AssetResult> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "assets.errors.notAllowed" };

  if (!isAssetKeyOwnedBy(path, user.id)) return { ok: false, code: "assets.errors.invalidPath" };

  const { error } = await supabase.storage.from(ASSET_POLICY[ns].bucket).remove([path]);
  if (error) {
    const code = mapAssetError(error);
    return code === "assets.errors.gone" ? { ok: true } : { ok: false, code };
  }
  return { ok: true };
}
