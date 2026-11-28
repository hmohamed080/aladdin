import { getServerSupabase } from "@/lib/supabase/server";
import { deliverMedia, mediaNotFound } from "@/server/storage/delivery";
import { isPortfolioObjectKey } from "@/lib/storage/professional-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Publication is checked before retrieval and before streaming, even for the owner. */
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await params;
    if (!UUID.test(itemId)) return mediaNotFound();
    const client = await getServerSupabase();
    const { data: key, error } = await client.rpc("public_portfolio_media_key", { p_item_id: itemId });
    if (error || typeof key !== "string" || !isPortfolioObjectKey(key)) return mediaNotFound();
    return await deliverMedia(client, "portfolio", key, async () => {
      const current = await client.rpc("public_portfolio_media_key", { p_item_id: itemId });
      return !current.error && current.data === key;
    });
  } catch { return mediaNotFound(); }
}
