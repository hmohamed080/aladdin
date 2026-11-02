"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { refreshEdgeMediaUrl } from "@/server/storage/edge-ticket";

/**
 * Re-issues an expired edge media URL for the signed-in caller after authorizing them again.
 * Null means the media is really unavailable to them (deleted, unpublished, signed out, foreign URL).
 */
export async function refreshMediaUrlAction(staleUrl: string): Promise<string | null> {
  return refreshEdgeMediaUrl(await getServerSupabase(), staleUrl);
}
