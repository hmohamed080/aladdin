"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { parseSellerError } from "@/features/marketplace-seller/errors";
import { readMarketplaceImageBytes } from "@/server/media/marketplace-image-bytes";
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
  reject: "admin_marketplace_seller_reject",
  suspend: "admin_marketplace_seller_suspend",
  revoke: "admin_marketplace_seller_revoke",
  reinstate: "admin_marketplace_seller_reinstate",
} as const;
export type SellerTransition = keyof typeof SELLER_RPC;

export type SellerTransitionInput = {
  /** Internal admin reason. Required for everything except approve. */
  reason: string;
  /** The owner-facing message: a preset id, or custom text ("other"), never both. */
  presetId?: string | null;
  message?: string | null;
};

/** Maps a refusal of the seller RPCs (plain messages, Postgres codes) to a stable code. */
function sellerErrorCode(error: { message?: string; code?: string }): string {
  const parsed = parseSellerError(error.message);
  if (parsed.code !== "unexpected") return parsed.code;
  if (error.code === "42501") return "not_permitted";
  if (error.code === "23514") return "transition_refused";
  if (error.code === "22023") {
    if (/reason/.test(error.message ?? "")) return "reason_required";
    return "message_invalid";
  }
  return "unexpected";
}

export async function sellerTransitionAction(
  organizationId: string,
  action: SellerTransition,
  input: SellerTransitionInput,
): Promise<AdminResult<{ status: string }>> {
  if (!(action in SELLER_RPC)) return { ok: false, code: "invalid_action" };
  const reason = input.reason.trim();
  if (action !== "approve" && reason.length < 3) return { ok: false, code: "reason_required" };
  const message = input.message?.trim() || null;
  const presetId = input.presetId || null;
  if (presetId && message) return { ok: false, code: "message_invalid" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc(SELLER_RPC[action], {
    p_organization_id: organizationId,
    p_reason: reason || undefined,
    p_preset_id: presetId ?? undefined,
    p_message: message ?? undefined,
  });
  if (error) return { ok: false, code: sellerErrorCode(error) };
  revalidatePath(SELLERS);
  return { ok: true, status: String(data) };
}

/**
 * Reads one image from the media system under the moderator's session (the marketplace media resolver),
 * decodes it on the server and records the verdict. The database refuses a VALID
 * verdict whose byte size differs from the stored object.
 */
async function validateOne(supabase: Awaited<ReturnType<typeof getServerSupabase>>, imageId: string) {
  const { data: row } = await supabase
    .from("marketplace_product_images")
    .select("id, object_key")
    .eq("id", imageId)
    .maybeSingle();
  if (!row) return { id: imageId, valid: false, code: "image_not_found" };
  let bytes: Uint8Array;
  try { bytes = await readMarketplaceImageBytes(supabase, row.object_key); }
  catch { return { id: imageId, valid: false, code: "download_failed" }; }
  const v = await validateImageBytes(bytes);
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

/**
 * Approves explicitly chosen images (a pending image, or a rejected one being reconsidered). Every image is
 * re-validated from its CURRENT bytes first; one that fails validation is reported, not approved.
 */
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

/** The tick: re-validates every pending image of the product from its current bytes, then approves them all. */
export async function approveProductAction(productId: string): Promise<AdminResult<{ results: { id: string; result: string }[] }>> {
  const supabase = await getServerSupabase();
  const { data: pending } = await supabase
    .from("marketplace_product_images")
    .select("id")
    .eq("product_id", productId)
    .eq("upload_state", "confirmed")
    .eq("status", "pending")
    .limit(100);
  for (const row of pending ?? []) await validateOne(supabase, row.id);
  const { data, error } = await supabase.rpc("admin_marketplace_product_review_approve", { p_product_id: productId });
  if (error) return { ok: false, code: parseSellerError(error.message).code };
  revalidatePath(MEDIA);
  return { ok: true, results: (data ?? []) as { id: string; result: string }[] };
}

export type RejectProductInput = {
  productId: string;
  /** null = every pending image of the product */
  imageIds: string[] | null;
  /** internal: stays in the admin audit trail */
  reason: string;
  /** owner-facing custom text, used when no preset is chosen */
  ownerMessage: string;
  presetId: string | null;
};

/**
 * The cross: rejects all pending images of the product, or only the chosen ones, with one internal reason and one
 * owner-facing message (a preset or custom text). The database writes the audit trail and notifies the owner in-app.
 */
export async function rejectProductAction(input: RejectProductInput): Promise<AdminResult<{ results: { id: string; result: string }[] }>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("admin_marketplace_product_review_reject", {
    p_product_id: input.productId,
    p_image_ids: (input.imageIds ?? null) as never,
    p_reason: input.reason.trim(),
    p_owner_message: input.presetId ? "" : input.ownerMessage.trim(),
    p_preset_id: input.presetId ?? undefined,
  });
  if (error) return { ok: false, code: parseSellerError(error.message).code };
  revalidatePath(MEDIA);
  return { ok: true, results: (data ?? []) as { id: string; result: string }[] };
}
