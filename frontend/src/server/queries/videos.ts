import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { readSessionIdentity } from "@/server/auth/session";
import type { VideoScope, VideoState } from "@/lib/media/video-policy";
import { privateVideoPlayback, publicVideoPlayback, videoEnabled, type VideoPlayback, type VideoSummary } from "@/server/video/playback";

/** One video as its manager (owner or catalog writer) sees it. */
export type ManagedVideo = VideoSummary & {
  scope: VideoScope;
  state: Exclude<VideoState, "deleted">;
  isPublic: boolean;
  failureCode: string | null;
  createdAt: string;
  playback: VideoPlayback | null;
  /** The portfolio project it belongs to, or null. */
  projectId?: string | null;
};

type Row = {
  id: string; title: string; duration_seconds: number | null; width: number | null; height: number | null;
  has_poster: boolean; sort_order?: number | null; slot?: number | null; created_at?: string | null;
};

function summary(row: Row): VideoSummary {
  return { id: row.id, title: row.title, durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width, height: row.height, hasPoster: row.has_poster,
    position: row.sort_order ?? row.slot ?? null, createdAt: row.created_at ?? null };
}

const MANAGED_COLUMNS = "id, scope, title, visibility, state, duration_seconds, width, height, has_poster, failure_code, created_at, sort_order, slot, project_id" as const;

/**
 * Videos the caller manages: their own portfolio videos, or one product's videos
 * for its publisher's members. RLS (media_videos_select_own / _select_publisher)
 * decides which rows come back; the filter only picks the list.
 */
export async function listManagedVideos(target: { scope: "portfolio" } | { scope: "product"; productId: string; workspace?: string | null }): Promise<ManagedVideo[]> {
  const supabase = await getServerSupabase();
  let query = supabase.from("media_videos").select(MANAGED_COLUMNS).neq("state", "deleted").eq("scope", target.scope);
  if (target.scope === "product") query = query.eq("product_id", target.productId);
  else {
    const identity = await readSessionIdentity(supabase);
    if (!identity) return [];
    query = query.eq("owner_user_id", identity.id);
  }
  const { data, error } = await query.order(target.scope === "product" ? "slot" : "sort_order", { ascending: true })
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (row) => {
    const video = summary(row);
    const playback = row.state === "ready"
      ? await privateVideoPlayback(supabase, video, { workspace: target.scope === "product" ? target.workspace ?? null : null }).catch(() => null)
      : null;
    return { ...video, scope: row.scope, state: row.state as ManagedVideo["state"], isPublic: row.visibility === "public",
      failureCode: row.failure_code, createdAt: row.created_at, playback, projectId: row.project_id };
  }));
}

/** Published videos on a public profile. Empty while video delivery is off. */
export async function loadPublicPortfolioVideos(profileId: string): Promise<VideoPlayback[]> {
  if (!videoEnabled()) return [];
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("public_portfolio_videos", { p_profile_id: profileId });
  if (error) return [];
  return (data ?? []).flatMap((row) => {
    const playback = publicVideoPlayback(summary(row));
    return playback ? [playback] : [];
  });
}

/** Ready videos of a product the caller may see (members, or the product's audience in `workspace`). */
export async function loadProductVideos(productId: string, workspace: string | null): Promise<VideoPlayback[]> {
  if (!videoEnabled()) return [];
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("product_videos", { p_product_id: productId, p_workspace: workspace ?? undefined });
  if (error) return [];
  const out = await Promise.all((data ?? []).map((row) => privateVideoPlayback(supabase, summary(row), { workspace }).catch(() => null)));
  return out.filter((v): v is VideoPlayback => v !== null);
}
