/**
 * The seller's image removal as ONE orchestrated, retry-safe operation
 * (Migration 07). Three steps, in this order, and the order is the point:
 *
 *   1. MARK      — the database withdraws the image (the row is kept so Storage can
 *                  still authorise the next step) and returns the object key.
 *   2. DELETE    — the caller's own Storage session deletes the bytes.
 *   3. FINALIZE  — the database forgets the row, but ONLY once it confirms the
 *                  object is gone from storage.
 *
 * "Removed" is reported only when step 3 succeeded. A failure at any step leaves
 * the image marked (hidden, never shown to anyone) so it can be retried: every step
 * is idempotent, and a retry resumes at the first step that is still undone.
 *
 * Kept free of Next / Supabase so each failure mode is unit-tested.
 */
export type RemovalDeps = {
  /** marketplace_seller_image_remove — returns the object key, or the refusal. */
  mark(imageId: string): Promise<{ key: string } | { error: string }>;
  /** Storage DELETE under the caller's session. `error` only for a transport / HTTP failure. */
  deleteObject(key: string): Promise<{ error?: string }>;
  /** marketplace_seller_image_remove_finalize — ok, or the refusal. */
  finalize(imageId: string): Promise<{ ok: true } | { error: string }>;
};

export type RemovalResult =
  | { ok: true; alreadyRemoved: boolean }
  | { ok: false; code: string; stage: "mark" | "delete" | "finalize" };

/** `mp:not_found` — the image row no longer exists, i.e. an earlier attempt already finished. */
const NOT_FOUND = "not_found";
const STILL_PRESENT = "object_still_present";

export async function removeImageLifecycle(deps: RemovalDeps, imageId: string): Promise<RemovalResult> {
  const marked = await deps.mark(imageId);
  if ("error" in marked) {
    // an earlier attempt completed (and its response was lost): nothing left to do
    if (marked.error === NOT_FOUND) return { ok: true, alreadyRemoved: true };
    return { ok: false, code: marked.error, stage: "mark" };
  }

  const deleted = await deps.deleteObject(marked.key);
  if (deleted.error) {
    // The row stays marked; the next attempt resumes here. Not reported as removed.
    return { ok: false, code: "delete_incomplete", stage: "delete" };
  }

  const finalized = await deps.finalize(imageId);
  if ("error" in finalized) {
    if (finalized.error === NOT_FOUND) return { ok: true, alreadyRemoved: true };
    // The database found the bytes still there: the delete did not really happen.
    return { ok: false, code: finalized.error === STILL_PRESENT ? "delete_incomplete" : finalized.error, stage: "finalize" };
  }
  return { ok: true, alreadyRemoved: false };
}
