"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { releaseReservation, removeMedia } from "@/server/storage/media";
import type { MediaNamespace } from "@/lib/storage/provider-types";

const NAMESPACES: readonly MediaNamespace[] = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification", "marketplace"];

/**
 * The browser's upload failed: free the caller's own reservation (ADR-0032). The database refuses anything that is not the
 * caller's own unfinished upload. Deleting partial bytes is best effort; the central cleanup removes what is left.
 */
export async function releaseUploadAction(namespace: MediaNamespace, key: string): Promise<{ ok: boolean }> {
  if (!NAMESPACES.includes(namespace) || typeof key !== "string" || key.length < 1 || key.length > 400) return { ok: false };
  const supabase = await getServerSupabase();
  if (!(await releaseReservation(supabase, namespace, key))) return { ok: false };
  try {
    await removeMedia(supabase, namespace, key);
  } catch {
    // left in the cleanup queue
  }
  return { ok: true };
}
