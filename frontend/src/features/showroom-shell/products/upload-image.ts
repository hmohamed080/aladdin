"use client";

import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { resizeImageForUpload, UPLOAD_RESIZE_PROFILES } from "@/lib/media/resize-image";
import { confirmProductImageUploadAction, requestProductImageUploadAction } from "@/server/actions/own-products";

/**
 * The one upload path for a product photo, shared by the image manager and the
 * create screen: ticket (pending metadata row, server-minted key) -> bytes straight
 * to the private bucket under that key -> confirm. Throws an i18n key on failure;
 * a failed upload leaves only an invisible pending row that expires on its own.
 *
 * The photo is first capped at 2560 px and re-encoded to WebP when that is smaller
 * (`resizeImageForUpload`); the ticket declares the prepared type and size, which
 * the server re-verifies from the stored bytes.
 */
export async function uploadProductImage(productId: string, picked: File): Promise<string> {
  const file = await resizeImageForUpload(picked, UPLOAD_RESIZE_PROFILES.product);
  const ticket = await requestProductImageUploadAction(productId, file.type, file.size);
  if (!ticket.ok) throw new Error(ticket.code);
  try { await uploadWithGrant(ticket.grant, file); }
  catch { throw new Error("showroomProducts.images.errorUpload"); }
  const confirmed = await confirmProductImageUploadAction(ticket.key);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.id;
}
