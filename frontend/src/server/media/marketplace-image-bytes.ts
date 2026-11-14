import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { mediaProvider, privilegedStorageClient, resolveMedia } from "@/server/storage/media";

/**
 * The bytes of one Marketplace image, read through the central media system (R2).
 * `client` must be allowed to READ the key by the marketplace media resolver (a member of
 * the seller organization, or a media moderator); anything else throws "media unavailable".
 */
export async function readMarketplaceImageBytes(client: SupabaseClient, key: string): Promise<Uint8Array> {
  const media = await resolveMedia(client, "marketplace", key, "read");
  const provider = await mediaProvider(media.provider === "supabase" ? privilegedStorageClient() : client, "marketplace", media.provider, key);
  return provider.readObject(key, MARKETPLACE_IMAGE_MAX_BYTES);
}

/**
 * The bytes of an image the PUBLIC shop may show. The caller has already established that with
 * `marketplace_public_image_ref` (service role); Marketplace photos are R2-only, so the object is
 * read with the backend credential from its ids-only R2 key.
 */
export async function readPublishedMarketplaceImageBytes(key: string): Promise<Uint8Array> {
  const provider = await mediaProvider(privilegedStorageClient(), "marketplace", "r2", key);
  return provider.readObject(key, MARKETPLACE_IMAGE_MAX_BYTES);
}

export type PublicMarketplaceImage = { bytes: ArrayBuffer; mimeType: string; sha256: string | null };

/**
 * The bytes of a currently publishable Marketplace image, or null for every other case (one
 * answer for all refusals). `marketplace_public_image_ref` is granted to service_role ONLY and
 * returns a reference only while EVERY publication condition holds (media flag on, image verified
 * + byte-validated, product published, seller enabled, type/category active, variant active). The
 * bytes are read from R2 and proxied by `/marketplace/media/[imageId]`; the browser never sees a
 * key or a signed URL.
 */
export async function loadPublicMarketplaceImage(imageId: string): Promise<PublicMarketplaceImage | null> {
  const { data, error } = await privilegedStorageClient().rpc("marketplace_public_image_ref", { p_image_id: imageId });
  const ref = Array.isArray(data) ? (data[0] as { object_key?: string; mime_type?: string | null; checksum_sha256?: string | null } | undefined) : undefined;
  if (error || !ref?.object_key) return null;
  try {
    const bytes = await readPublishedMarketplaceImageBytes(ref.object_key);
    return { bytes: bytes.slice().buffer, mimeType: ref.mime_type || "application/octet-stream", sha256: ref.checksum_sha256 ?? null };
  } catch {
    return null;
  }
}
