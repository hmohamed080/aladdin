"use client";

import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { resizeImageForUpload, UPLOAD_RESIZE_PROFILES } from "@/lib/media/resize-image";
import { confirmRequestImageUploadAction, requestRequestImageUploadAction } from "@/server/actions/purchase-requests";

/**
 * The one upload path for a purchase-request reference photo: ticket (pending row, server-minted key and
 * storage grant) -> bytes straight to private storage -> server verification and confirm. Throws an i18n
 * key on failure; a failed upload leaves only an invisible pending row that expires on its own, and
 * nothing is written anywhere else.
 */
export async function uploadRequestImage(itemId: string, picked: File): Promise<string> {
  const prepared = await resizeImageForUpload(picked, UPLOAD_RESIZE_PROFILES.request);
  if (!prepared.ok) throw new Error("purchaseRequests.errors.imageType");
  const file = prepared.file;
  const ticket = await requestRequestImageUploadAction(itemId, file.type, file.size);
  if (!ticket.ok) throw new Error(ticket.code);
  try { await uploadWithGrant(ticket.grant, file); }
  catch { throw new Error("states.genericRetry"); }
  const confirmed = await confirmRequestImageUploadAction(ticket.key);
  if (!confirmed.ok) throw new Error(confirmed.code);
  return confirmed.id;
}
