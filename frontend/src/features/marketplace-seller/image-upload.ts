"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { confirmImageUploadAction, removeImageAction, requestImageUploadAction } from "@/server/actions/marketplace-seller";
import { MARKETPLACE_IMAGE_BUCKET } from "./errors";

/** The image formats and size the private bucket accepts (Migration 06). */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Upload keys a product may hold open at once (Migration 07 abuse limit). */
export const MAX_IMAGES_PER_BATCH = 10;

export type UploadFailure = { name: string; code: string };

/** Client-side pre-check; the bucket and the confirm RPC check again. */
export function imageFileProblem(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "image_type_invalid";
  if (file.size > MAX_IMAGE_BYTES) return "file_too_large";
  return null;
}

/**
 * Uploads images of ONE product the trusted way: an upload ticket from the
 * database (`requestImageUploadAction`), the bytes straight to the private
 * bucket under the seller's own session, then the confirm step (magic-byte
 * check). Every image starts `pending` — customers see it only after admin
 * moderation. Returns the files that did not make it, with a reason code.
 */
export async function uploadProductImages(
  productId: string,
  files: File[],
  onProgress?: (name: string | null) => void,
): Promise<UploadFailure[]> {
  const supabase = createBrowserSupabaseClient();
  const failures: UploadFailure[] = [];
  for (const [index, file] of files.entries()) {
    const problem = imageFileProblem(file);
    if (problem) {
      failures.push({ name: file.name, code: problem });
      continue;
    }
    onProgress?.(file.name);
    const ticket = await requestImageUploadAction(productId, file.type);
    if (!ticket.ok) {
      // a ticket refusal (limit reached, not permitted) applies to the rest too
      for (const rest of files.slice(index)) failures.push({ name: rest.name, code: ticket.code });
      break;
    }
    const { error } = await supabase.storage
      .from(MARKETPLACE_IMAGE_BUCKET)
      .upload(ticket.objectKey, file, { contentType: file.type, upsert: false, cacheControl: "300" });
    if (error) {
      failures.push({ name: file.name, code: "upload_failed" });
      await removeImageAction(ticket.imageId);
      continue;
    }
    const confirmed = await confirmImageUploadAction(ticket.imageId);
    if (!confirmed.ok) failures.push({ name: file.name, code: confirmed.code });
  }
  onProgress?.(null);
  return failures;
}
