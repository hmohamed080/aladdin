"use server";

import { mapAssetError } from "@/server/actions/error-mapping";
import { authorizeMediaUpload, removeMedia } from "@/server/storage/media";
import { readableMediaUrl } from "@/server/storage/edge-ticket";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  ASSET_NAMESPACES,
  isAssetKeyForCaller,
  type AssetErrorCode,
  type AssetNamespace,
} from "@/lib/storage/professional-assets";

/** Browser arguments are untrusted. Canonical metadata/RPCs decide identity and ownership.
 * Metadata RPCs retain caller RLS. Provider operations follow the same
 * caller-authorized resolver before server-only credentials are used.
 */

export type AssetTicket =
  | { readonly ok: true; readonly token: string; readonly grant?: UploadGrant }
  | { readonly ok: false; readonly code: AssetErrorCode };

export type AssetUrl =
  | { readonly ok: true; readonly url: string }
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

/** The metadata resolver authorizes a pending owner upload. R2 grants target only a
 * temporary key; final bytes are a separate immutable backend-written object.
 * Supabase uploads retain upsert:false and their existing INSERT policies.
 */
export async function createAssetUploadTicket(
  namespace: string,
  objectPath: string,
  expectedBytes?: number,
): Promise<AssetTicket> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const { supabase, error } = await callerFor(ns, objectPath);
  if (error) return { ok: false, code: error };

  try {
    const grant = await authorizeMediaUpload(supabase, ns, objectPath, expectedBytes);
    return { ok: true, token: grant.provider === "supabase" ? grant.token : "", grant };
  } catch (error) { return { ok: false, code: mapAssetError(error) }; }
}

/**
 * Returns an application URL, or (edge delivery on, R2 row) a media-Worker URL
 * with a 60–120 s ticket. Every GET reauthorizes in the database; this action's
 * authorization is not a bearer grant and no provider token leaves the server.
 *
 * There is no variant that takes a bucket — the namespace is a closed set of two
 * and the bucket is looked up — so no caller can name `professional-certificates`
 * while a portfolio surface believes it asked for a photo.
 *
 * A refusal comes back as `gone`: canonical metadata hides foreign/missing
 * objects alike, without obtaining a provider credential or probing bytes.
 */
export async function createAssetReadUrl(namespace: string, objectPath: string): Promise<AssetUrl> {
  const ns = readNamespace(namespace);
  if (!ns) return { ok: false, code: "assets.errors.invalidPath" };

  const { supabase, error } = await callerFor(ns, objectPath);
  if (error) return { ok: false, code: error };

  try {
    const url = await readableMediaUrl(supabase, ns, objectPath);
    return { ok: true, url };
  } catch { return { ok: false, code: "assets.errors.gone" }; }
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

  try {
    await removeMedia(supabase, ns, objectPath);
    return { ok: true };
  } catch (error) { return { ok: false, code: mapAssetError(error) }; }
}
