import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceImageMap, MarketplaceImageUrls } from "@/lib/storage/marketplace-images";
import { MEDIA_VARIANTS, type MediaVariant } from "@/lib/media/image-variants";
import { edgeConfig, privateMediaUrl, publicEdgeSources, publicMediaUrl } from "@/server/storage/edge-ticket";
import { privilegedStorageClient } from "@/server/storage/media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Public URLs for shop images by image id, the way public portfolio media is served: the media
 * Worker (Mode C) with the recorded sizes while public edge delivery is on — the database
 * (`public_media_edge_sources` -> `media_edge_public`) names only images it may show right now —
 * and `/marketplace/media/<id>` otherwise. One RPC per 100 images.
 */
export async function marketplacePublicImageUrls(client: SupabaseClient, imageIds: readonly (string | null | undefined)[]): Promise<MarketplaceImageMap> {
  const ids = [...new Set(imageIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  const edge = await publicEdgeSources(client, "marketplace", ids);
  const out: Record<string, MarketplaceImageUrls> = {};
  for (const id of ids) {
    const recorded = edge.get(id);
    if (!recorded) { out[id] = { src: publicMediaUrl("marketplace", id, false)! }; continue; }
    const urls: MarketplaceImageUrls = { src: publicMediaUrl("marketplace", id, true)! };
    for (const size of MEDIA_VARIANTS) if (recorded.includes(size)) urls[size] = publicMediaUrl("marketplace", id, true, size)!;
    out[id] = urls;
  }
  return out;
}

/**
 * URLs for images the caller may ALREADY read (seller members, media moderators): a ticketed
 * Worker URL for the requested size while edge delivery is on and that size is recorded, else the
 * original; `/api/media/marketplace` while edge delivery is off (the proxy serves originals only).
 * The Worker and /api/media re-check the caller's authority on every request.
 */
export async function marketplacePrivateImageUrls(client: SupabaseClient, keys: readonly string[], size: MediaVariant): Promise<Map<string, string>> {
  const unique = [...new Set(keys)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  // Recorded sizes per key (metadata only; the keys came from the caller's own authorized page read).
  const { data } = edgeConfig()
    ? await privilegedStorageClient().from("media_storage_locations").select("object_key, variants")
      .eq("namespace", "marketplace").in("object_key", unique)
    : { data: [] as { object_key: string; variants: unknown }[] };
  const sized = new Set((data ?? []).filter((row) => row.variants && typeof row.variants === "object" && size in (row.variants as object))
    .map((row) => row.object_key));
  for (const key of unique) {
    out.set(key, await privateMediaUrl(client, "marketplace", key, "r2", sized.has(key) ? { variant: size } : {}));
  }
  return out;
}
