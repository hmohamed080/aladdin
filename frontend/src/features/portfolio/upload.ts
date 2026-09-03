"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
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

export async function uploadAsset(
  namespace: AssetNamespace,
  file: File,
  start: () => Promise<UploadTicket>,
  finish: (itemId: string) => Promise<{ ok: boolean; code?: string }>,
): Promise<UploadOutcome> {
  const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const valid = validateAssetContent(namespace, { type: file.type, size: file.size }, head);
  if (!valid.ok) return { ok: false, code: valid.code };

  const ticket = await start();
  if (!ticket.ok) return { ok: false, code: ticket.code };

  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.storage
    .from(ticket.bucket)
    .uploadToSignedUrl(ticket.objectPath, ticket.token, file, {
      contentType: file.type,
      // Named explicitly even though the token already forbids it. A reader of
      // this call should not have to know that to know the answer.
      upsert: false,
    });

  if (error) {
    // The pending row is left where it is on purpose. It is the record that this
    // upload was attempted, it is invisible to everyone but its owner, and the
    // card it produces is how they finish or discard it.
    return { ok: false, code: "assets.errors.uploadFailed" };
  }

  const finished = await finish(ticket.itemId);
  return finished.ok ? { ok: true } : { ok: false, code: finished.code ?? "states.genericRetry" };
}
