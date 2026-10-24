"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { MARKETPLACE_IMAGE_BUCKET, parseSellerError } from "@/features/marketplace-seller/errors";
import { validateImageBytes } from "@/server/media/validate-image";

/**
 * Admin Marketplace writers. Every one runs under the ADMIN'S OWN session and
 * calls a SECURITY DEFINER RPC that re-checks the admin permission
 * (marketplace_sellers.manage / marketplace_media.moderate) — the UI is never
 * the gate. No service credential is used here.
 */
export type AdminResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

const SELLERS = "/admin/marketplace";
const MEDIA = "/admin/marketplace/media";

const SELLER_RPC = {
  approve: "admin_marketplace_seller_approve",
  suspend: "admin_marketplace_seller_suspend",
  revoke: "admin_marketplace_seller_revoke",
  reinstate: "admin_marketplace_seller_reinstate",
} as const;
export type SellerTransition = keyof typeof SELLER_RPC;

export async function sellerTransitionAction(
  organizationId: string,
  action: SellerTransition,
  reason: string,
): Promise<AdminResult<{ status: string }>> {
  if (!(action in SELLER_RPC)) return { ok: false, code: "invalid_action" };
  if (reason.trim().length < 3) return { ok: false, code: "reason_required" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc(SELLER_RPC[action], { p_organization_id: organizationId, p_reason: reason.trim() });
  if (error) {
    const parsed = parseSellerError(error.message);
    // the seller RPCs (Migration 04) raise plain messages; map the permission and state refusals
    const code =
      parsed.code !== "unexpected" ? parsed.code
      : error.code === "42501" ? "not_permitted"
      : error.code === "23514" ? "transition_refused"
      : error.code === "22023" ? "reason_required"
      : "unexpected";
    return { ok: false, code };
  }
  revalidatePath(SELLERS);
  return { ok: true, status: String(data) };
}

/**
 * Downloads one image under the moderator's session (moderator storage policy),
 * decodes it on the server and records the verdict. The database refuses a VALID
 * verdict whose byte size differs from the stored object.
 */
async function validateOne(supabase: Awaited<ReturnType<typeof getServerSupabase>>, imageId: string) {
  const { data: row } = await supabase
    .from("marketplace_product_images")
    .select("id, object_key, storage_bucket")
    .eq("id", imageId)
    .maybeSingle();
  if (!row) return { id: imageId, valid: false, code: "image_not_found" };
  const { data: blob, error } = await supabase.storage.from(row.storage_bucket || MARKETPLACE_IMAGE_BUCKET).download(row.object_key);
  if (error || !blob) return { id: imageId, valid: false, code: "download_failed" };
  const v = await validateImageBytes(Buffer.from(await blob.arrayBuffer()));
  const { error: recErr } = await supabase.rpc("admin_marketplace_media_record_validation", {
    p_image_id: imageId,
    p_valid: v.valid,
    p_format: v.valid ? v.format : null,
    p_width: v.valid ? v.width : null,
    p_height: v.valid ? v.height : null,
    p_byte_size: v.byteSize,
    p_sha256: v.sha256,
    p_note: v.valid ? null : v.reason,
  } as never);
  if (recErr) return { id: imageId, valid: false, code: parseSellerError(recErr.message).code };
  return { id: imageId, valid: v.valid, code: v.valid ? "valid" : v.reason };
}

export async function validateImagesAction(imageIds: string[]): Promise<AdminResult<{ results: { id: string; valid: boolean; code: string }[] }>> {
  const ids = [...new Set(imageIds)].slice(0, 100);
  const supabase = await getServerSupabase();
  const results = [];
  for (const id of ids) results.push(await validateOne(supabase, id));
  revalidatePath(MEDIA);
  return { ok: true, results };
}

/** Re-validates every selected image from its CURRENT bytes, then approves; an image that fails is not approved. */
export async function approveImagesAction(imageIds: string[]): Promise<AdminResult<{ results: { id: string; result: string }[] }>> {
  const ids = [...new Set(imageIds)].slice(0, 100);
  if (!ids.length) return { ok: false, code: "images_invalid" };
  const supabase = await getServerSupabase();
  for (const id of ids) await validateOne(supabase, id);
  const { data, error } = await supabase.rpc("admin_marketplace_media_approve", { p_image_ids: ids });
  if (error) return { ok: false, code: parseSellerError(error.message).code };
  revalidatePath(MEDIA);
  return { ok: true, results: (data ?? []) as { id: string; result: string }[] };
}

export async function rejectImagesAction(imageIds: string[], reason: string): Promise<AdminResult<{ results: { id: string; result: string }[] }>> {
  const ids = [...new Set(imageIds)].slice(0, 100);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_media_reject", { p_image_ids: ids, p_reason: reason.trim() });
  if (error) return { ok: false, code: parseSellerError(error.message).code };
  revalidatePath(MEDIA);
  return { ok: true, results: (data ?? []) as { id: string; result: string }[] };
}

export async function setMediaReadyAction(ready: boolean, reason: string): Promise<AdminResult<{ ready: boolean }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_set_media_verification_ready", { p_ready: ready, p_reason: reason.trim() });
  if (error) return { ok: false, code: parseSellerError(error.message).code };
  revalidatePath(MEDIA);
  revalidatePath("/marketplace");
  return { ok: true, ready: Boolean(data) };
}
