"use client";

import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { resizeImageForUpload, UPLOAD_RESIZE_PROFILES } from "@/lib/media/resize-image";
import {
  ASSET_POLICY,
  validateAssetContent,
  type AssetNamespace,
} from "@/lib/storage/professional-assets";
import type { UploadTicket } from "@/server/actions/portfolio";

/**
 * The browser's half of the upload, in one place so both forms tell the same
 * story and neither invents its own recovery rules.
 *
 * THREE STEPS, AND WHY THEY ARE IN THIS ORDER (§7, S3):
 *
 *   0. PREPARE. A photo is downscaled (long edge 2560 px; certificates 3200 px)
 *      and re-encoded to WebP when that makes it smaller (`resizeImageForUpload`).
 *      The prepared file is what gets validated, declared to `start` and
 *      uploaded, so its type and size are the ones the server checks. A browser
 *      that cannot resize uploads the original. PDFs are never touched.
 *   1. VALIDATE locally. Type, size, and the file's first bytes against the type
 *      it claims. None of this is authority — the bucket enforces type and size
 *      again from its own row, before Postgres is consulted — but it is the only
 *      way a person learns their 8 MB photo is too large without waiting for an
 *      8 MB upload to fail.
 *   2. START. The server creates the metadata row and returns a single-use token
 *      bound to one bucket, one key and `upsert: false`. The row exists before any
 *      bytes do, so the object identity is decided and recorded rather than
 *      inferred afterwards.
 *   3. UPLOAD, then FINISH. Bytes go straight from the browser to Storage — they
 *      never pass through the Next server — and only then is the row marked ready.
 *
 * WHAT HAPPENS WHEN A STEP FAILS, which is the part that matters:
 *
 *   * start fails            nothing exists. Nothing to clean up.
 *   * upload fails           a PENDING row remains. It is invisible to the public,
 *                            cannot be published (the table refuses it), and the
 *                            owner sees an "unfinished" card with Discard.
 *   * finish fails           the same pending row, but the bytes are there too.
 *     or the response         `portfolio_item_finalize` is IDEMPOTENT, so simply
 *     is lost                 calling it again completes the upload — which is
 *                             what the retry below does, and what the card's
 *                             Finish button does after a reload.
 *
 * At no point is a half-finished item publicly usable, and no failure leaves a
 * state that a repeat of the same sequence cannot resolve.
 */

export type UploadOutcome = { ok: true } | { ok: false; code: string };

/** How many bytes of the head we need to recognise every accepted signature. */
const SIGNATURE_BYTES = 16;

/** A source larger than this is refused before decoding; resizing could not save it anyway. */
const MAX_SOURCE_FACTOR = 4;

export async function uploadAsset(
  namespace: AssetNamespace,
  original: File,
  /** Receives the PREPARED file's type and size: those are what will be uploaded. */
  start: (prepared: { type: string; size: number }) => Promise<UploadTicket>,
  finish: (itemId: string) => Promise<{ ok: boolean; code?: string }>,
  onProgress?: (percent: number) => void,
): Promise<UploadOutcome> {
  const file = original.size <= ASSET_POLICY[namespace].maxBytes * MAX_SOURCE_FACTOR
    ? await resizeImageForUpload(original, UPLOAD_RESIZE_PROFILES[namespace])
    : original;
  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const valid = validateAssetContent(namespace, { type: file.type, size: file.size }, head);
  if (!valid.ok) return { ok: false, code: valid.code };

  let ticket: UploadTicket;
  try { ticket = await start({ type: file.type, size: file.size }); }
  catch { return { ok: false, code: "assets.errors.uploadFailed" }; }
  if (!ticket.ok) return { ok: false, code: ticket.code };

  try {
    await uploadWithGrant(ticket.grant ?? { provider: "supabase", bucket: ticket.bucket,
      key: ticket.objectPath, token: ticket.token }, file, onProgress);
  } catch { return { ok: false, code: "assets.errors.uploadFailed" }; }

  try {
    const finished = await finish(ticket.itemId);
    return finished.ok ? { ok: true } : { ok: false, code: finished.code ?? "states.genericRetry" };
  } catch { return { ok: false, code: "assets.errors.uploadFailed" }; }
}
