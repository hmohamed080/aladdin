"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { mapAssetError } from "@/server/actions/error-mapping";
import {
  ASSET_NAMESPACES,
  ASSET_POLICY,
  ASSET_READ_URL_SECONDS,
  isAssetKeyForCaller,
  type AssetErrorCode,
  type AssetNamespace,
} from "@/lib/storage/professional-assets";

/**
 * The three ways a professional's file moves: in, out, and away.
 *
 * WHAT CHANGED IN INCREMENT 11. These used to DERIVE the object path from
 * `auth.getUser()`. They no longer do — the path arrives from
 * `portfolio_item_create` / `certificate_create`, which mint it inside the same
 * transaction that creates the metadata row. That is S3 applied to identity as
 * well as to state: the row is the product authority, so the object it names has
 * to be decided where the row is, not in a separate call that could succeed while
 * the row does not.
 *
 * It also means these helpers no longer decide anything about ownership for
 * portfolio. They cannot: an opaque key states nothing about who owns it, which is
 * exactly why it is opaque. Ownership is answered by `app.owns_portfolio_object`
 * inside the storage policy, against the metadata row. The shape check below is a
 * fast, specific refusal and NOT the boundary.
 *
 * THESE ARE `"use server"` EXPORTS, so every argument arrives from a browser and
 * none of it is trusted. Service-role is still never used: every call runs as the
 * caller's own identity, so a bug here widens nothing.
 */

export type AssetTicket =
  | { readonly ok: true; readonly token: string }
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

async function callerFor(namespace: AssetNamespace, objectPath: string) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "assets.errors.notAllowed" as const };
  if (!isAssetKeyForCaller(namespace, objectPath, user.id)) {
    return { supabase, error: "assets.errors.invalidPath" as const };
  }
  return { supabase, error: null };
}

/**
 * Upload authority: a single-use token bound to one bucket, one key and
 * `upsert: false`, all three inside the signature.
 *
 * The persona gate is not re-implemented here and never was. For a certificate
 * the INSERT policy consults `app.can_create_professional_asset` directly; for
 * portfolio it consults `app.can_upload_portfolio_object`, which requires a
 * PENDING row the caller owns — and only `portfolio_item_create` can produce one,
 * which is where the persona is checked. Either way the refusal comes from the
 * database and this file only translates it.
 */
export async function createAssetUploadTicket(
  namespace: string,
  objectPath: string,
): Promise<AssetTicket> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const { supabase, error } = await callerFor(ns, objectPath);
  if (error) return { ok: false, code: error };

  const { data, error: signError } = await supabase.storage
    .from(ASSET_POLICY[ns].bucket)
    .createSignedUploadUrl(objectPath);

  if (signError || !data) return { ok: false, code: mapAssetError(signError) };
  return { ok: true, token: data.token };
}

/**
 * Read authority (§11): short-lived, minted per object, never stored.
 *
 * There is no variant that takes a bucket — the namespace is a closed set of two
 * and the bucket is looked up — so no caller can name `professional-certificates`
 * while a portfolio surface believes it asked for a photo.
 *
 * A refusal comes back as `gone` rather than `notAllowed`, because that is what
 * Storage actually says: the SELECT policy hides the row so completely that a
 * foreign object is indistinguishable from one that never existed.
 */
export async function createAssetReadUrl(namespace: string, objectPath: string): Promise<AssetUrl> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const { supabase, error } = await callerFor(ns, objectPath);
  if (error) return { ok: false, code: error };

  const { data, error: signError } = await supabase.storage
    .from(ASSET_POLICY[ns].bucket)
    .createSignedUrl(objectPath, ASSET_READ_URL_SECONDS);

  if (signError || !data?.signedUrl) return { ok: false, code: mapAssetError(signError) };
  return { ok: true, url: data.signedUrl, expiresIn: ASSET_READ_URL_SECONDS };
}

/**
 * Delete authority (§12): one object, named in full, belonging to the caller.
 * No folder form and no wildcard, because the argument that would enable a bulk
 * delete is the same one that would enable someone else's.
 *
 * IDEMPOTENT BY DESIGN. `NoSuchKey` is folded into success: the caller asked for
 * the object to be gone and it is gone. Increment 11 depends on this — deleting an
 * item is `mark deleted → remove object → purge row`, and a retry after a partial
 * failure has to converge rather than jam on the half that already succeeded.
 */
export async function deleteProfessionalAsset(
  namespace: string,
  objectPath: string,
): Promise<AssetResult> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const { supabase, error } = await callerFor(ns, objectPath);
  if (error) return { ok: false, code: error };

  const { error: removeError } = await supabase.storage
    .from(ASSET_POLICY[ns].bucket)
    .remove([objectPath]);

  if (removeError) {
    const code = mapAssetError(removeError);
    return code === "assets.errors.gone" ? { ok: true } : { ok: false, code };
  }
  return { ok: true };
}
