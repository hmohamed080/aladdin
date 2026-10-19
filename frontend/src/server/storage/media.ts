import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readPublicEnv } from "@/lib/env";
import { readStorageEnv } from "@/lib/env/storage";
import { mediaPolicy, isOrganizationMedia } from "@/lib/storage/media-policy";
import type { MediaNamespace, StorageProviderName } from "@/lib/storage/provider-types";
import { SupabaseStorageProvider } from "./supabase-provider";
import { CloudflareR2StorageProvider } from "./r2-provider";
import { verifyMediaBytes } from "./validation";
import { generateImageVariants, variantManifest, type VariantManifest } from "./public-image-variants";
import type { StorageProvider } from "@/lib/storage/provider-types";
import { applicationMediaUrl } from "@/lib/storage/media-url";

const descriptor = z.object({ provider: z.enum(["supabase", "r2"]), contentType: z.string(),
  reserved: z.boolean(), state: z.enum(["pending", "ready", "deleted"]), owner: z.string().uuid().nullable() });

export async function resolveMedia(client: SupabaseClient, namespace: MediaNamespace, key: string, operation: "read" | "upload" | "delete", workspace?: string | null) {
  const { data, error } = await client.rpc(isOrganizationMedia(namespace) ? "organization_media_resolve" : "media_storage_resolve", {
    p_namespace: namespace, p_key: key, p_operation: operation,
    ...(isOrganizationMedia(namespace) ? { p_workspace: workspace ?? null } : {}),
  });
  if (error || !data) throw new Error("media unavailable");
  return descriptor.parse(data);
}

export function mediaProvider(client: SupabaseClient, namespace: MediaNamespace, provider: StorageProviderName) {
  return provider === "r2" ? new CloudflareR2StorageProvider(namespace)
    : new SupabaseStorageProvider(client, mediaPolicy(namespace).bucket);
}

export function privilegedStorageClient() {
  const env = readStorageEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("media verifier credentials missing");
  return createClient(readPublicEnv().NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireWriteApproval(provider: StorageProviderName) {
  if (provider === "r2" && readPublicEnv().NEXT_PUBLIC_APP_ENV === "production"
    && !readStorageEnv().R2_PRODUCTION_WRITES_APPROVED) throw new Error("production R2 writes are not approved");
}

export async function authorizeMediaUpload(client: SupabaseClient, namespace: MediaNamespace, key: string, expectedBytes?: number) {
  const media = await resolveMedia(client, namespace, key, "upload");
  const env = readStorageEnv();
  // Existing R2 records remain R2 when routing is disabled. Reserve is authoritative and rejects provider changes.
  const provider = media.reserved ? media.provider : env.R2_STORAGE_ENABLED ? "r2" : "supabase";
  requireWriteApproval(provider);
  const maxBytes = mediaPolicy(namespace).maxBytes;
  if (provider === "r2" && (!expectedBytes || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes)) {
    throw new Error("upload size is outside policy");
  }
  if (!media.reserved) {
    const backendReservation = provider === "r2" || isOrganizationMedia(namespace);
    const reserveClient = backendReservation ? privilegedStorageClient() : client;
    const { error } = await reserveClient.rpc("media_storage_reserve", { p_namespace: namespace, p_key: key,
      p_provider: provider, ...(backendReservation ? { p_owner: media.owner } : {}) });
    if (error) throw new Error("upload limit or reservation failure");
  }
  return mediaProvider(client, namespace, provider).createUploadUrl(key, media.contentType, expectedBytes);
}

/**
 * Derived thumb/card/full WebP from the VERIFIED bytes, written beside the
 * original by providers that store variants (R2). Best-effort by design: the
 * original is the retained reference and renders without variants, so a busy
 * decode slot or a variant write failure never fails the upload — the backfill
 * regenerates from the original later.
 */
async function storeVariants(provider: StorageProvider, namespace: MediaNamespace, key: string, bytes: Uint8Array, contentType: string): Promise<VariantManifest | null> {
  if (!provider.putVariant || !contentType.startsWith("image/")) return null;
  try {
    const variants = await generateImageVariants(bytes);
    for (const variant of variants) await provider.putVariant(key, variant.variant, variant.bytes);
    return variantManifest(variants);
  } catch (error) {
    console.warn(JSON.stringify({ event: "media.variants_skipped", namespace, reason: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

/** Returns the stored variant manifest when one was produced (for the WP1 receipt column), else null. */
export async function verifyPendingMedia(client: SupabaseClient, namespace: MediaNamespace, key: string): Promise<VariantManifest | null> {
  // Organization reads deliberately exclude pending rows. A ready retry must
  // still pass current membership/audience authorization before returning.
  if (!isOrganizationMedia(namespace)) {
    const media = await resolveMedia(client, namespace, key, "read");
    if (media.state === "ready") return null;
  } else {
    try { await resolveMedia(client, namespace, key, "upload"); }
    catch {
      const media = await resolveMedia(client, namespace, key, "read");
      if (media.state === "ready") return null;
      throw new Error("media unavailable");
    }
  }
  const pending = await resolveMedia(client, namespace, key, "upload");
  if (!pending.owner) throw new Error("owner required");
  if (!pending.reserved) {
    const reserveClient = isOrganizationMedia(namespace) ? privilegedStorageClient() : client;
    const { error: reserveError } = await reserveClient.rpc("media_storage_reserve", {
      p_namespace: namespace, p_key: key, p_provider: pending.provider,
      ...(isOrganizationMedia(namespace) ? { p_owner: pending.owner } : {}),
    });
    if (reserveError) throw new Error("reservation failed");
  }
  const provider = mediaProvider(pending.provider === "supabase" ? privilegedStorageClient() : client, namespace, pending.provider);
  requireWriteApproval(pending.provider);
  const maxBytes = mediaPolicy(namespace).maxBytes;
  const bytes = await provider.readObject(key, maxBytes);
  const verified = await verifyMediaBytes(bytes, pending.contentType, maxBytes);
  await provider.commitVerifiedObject(key, bytes, verified.contentType);
  const variants = await storeVariants(provider, namespace, key, bytes, verified.contentType);
  const admin = privilegedStorageClient();
  const { error } = await admin.rpc("media_storage_attest", {
    p_namespace: namespace, p_key: key, p_owner: pending.owner, p_provider: pending.provider,
    p_size: verified.size, p_content_type: verified.contentType, p_sha256: verified.sha256,
  });
  if (error) throw new Error("verification receipt refused");
  // Variants are disposable: an unrecorded manifest only means originals are served
  // until the backfill records it. Edge URLs are issued only for recorded variants.
  if (variants && Object.keys(variants).length > 0) {
    const { error: variantError } = await admin.rpc("media_storage_record_variants", {
      p_namespace: namespace, p_key: key, p_owner: pending.owner, p_variants: variants,
    });
    if (variantError) console.warn(JSON.stringify({ event: "media.variants_unrecorded", namespace }));
  }
  console.info(JSON.stringify({ event: "media.verified", namespace, provider: pending.provider, bytes: verified.size, variants: variants ? Object.keys(variants).length : 0 }));
  return variants;
}

export async function readMediaUrl(client: SupabaseClient, namespace: MediaNamespace, key: string) {
  const media = await resolveMedia(client, namespace, key, "read");
  if ((!isOrganizationMedia(namespace) && !media.owner) || media.state !== "ready") throw new Error("media unavailable");
  return applicationMediaUrl(namespace, key);
}

export async function removeMedia(client: SupabaseClient, namespace: MediaNamespace, key: string) {
  const media = await resolveMedia(client, namespace, key, "delete");
  await mediaProvider(media.provider === "supabase" ? privilegedStorageClient() : client, namespace, media.provider).deleteObject(key);
}
