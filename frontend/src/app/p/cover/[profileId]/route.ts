import { getServerSupabase } from "@/lib/supabase/server";
import { deliverMedia, mediaNotFound } from "@/server/storage/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * `/p/cover/<profileId>` - the cover image of a currently LISTED professional profile, for the public profile page.
 * Publication is re-proved before retrieval and again before streaming (`public_profile_cover_key`), exactly like
 * `/p/media/<itemId>`; an unlisted, unknown or cover-less profile is the same 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!UUID.test(profileId)) return mediaNotFound();
    const client = await getServerSupabase();
    const { data: key, error } = await client.rpc("public_profile_cover_key", { p_profile_id: profileId });
    if (error || typeof key !== "string" || !KEY.test(key)) return mediaNotFound();
    return await deliverMedia(client, "avatar", key, async () => {
      const current = await client.rpc("public_profile_cover_key", { p_profile_id: profileId });
      return !current.error && current.data === key;
    });
  } catch {
    return mediaNotFound();
  }
}
