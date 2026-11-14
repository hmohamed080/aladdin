"use client";

import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { confirmImageUploadAction, removeImageAction, requestImageUploadAction } from "@/server/actions/marketplace-seller";

/** The image formats and size the `marketplace` media namespace accepts (Migration 13). */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = MARKETPLACE_IMAGE_ALLOWED_TYPES;
export const MAX_IMAGE_BYTES = MARKETPLACE_IMAGE_MAX_BYTES;
/** Upload keys a product may hold open at once (Migration 07 abuse limit). */
export const MAX_IMAGES_PER_BATCH = 10;

export type UploadFailure = { name: string; code: string };

/** Client-side pre-check; the media verifier and the confirm RPC check again. */
export function imageFileProblem(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "image_type_invalid";
  if (file.size > MAX_IMAGE_BYTES) return "file_too_large";
  return null;
}

/**
 * Uploads images of ONE product the trusted way: an upload ticket from the
 * database plus an R2 upload grant from the server (`requestImageUploadAction`),
 * the bytes straight to that grant, then the confirm step (server-side byte
 * verification). Every image starts `pending` — customers see it only after admin
 * moderation. Returns the files that did not make it, with a reason code.
 */
export async function uploadProductImages(
  productId: string,
  files: File[],
  onProgress?: (name: string | null) => void,
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];
  for (const [index, file] of files.entries()) {
    const problem = imageFileProblem(file);
    if (problem) {
      failures.push({ name: file.name, code: problem });
      continue;
    }
    onProgress?.(file.name);
    const ticket = await requestImageUploadAction(productId, file.type, file.size);
    if (!ticket.ok) {
      // a ticket refusal (limit reached, not permitted) applies to the rest too
      for (const rest of files.slice(index)) failures.push({ name: rest.name, code: ticket.code });
      break;
    }
    try {
      await uploadWithGrant(ticket.grant, file);
    } catch {
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
