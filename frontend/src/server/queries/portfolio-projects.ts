import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import { listMyPortfolio, type PublicPortfolioItem } from "@/server/queries/portfolio";
import { listManagedVideos, loadPublicPortfolioVideos } from "@/server/queries/videos";
import { publicEdgeSources, publicPortfolioSource, readableMediaSource } from "@/server/storage/edge-ticket";
import { videoEnabled, type VideoPlayback } from "@/server/video/playback";

/** The approved limits (20261021090009_portfolio_projects.sql enforces them). */
export const PORTFOLIO_MAX_PROJECTS = 15;
export const PORTFOLIO_MAX_PROJECT_MEDIA = 6;

export type ProjectMediaKind = "image" | "video";

/** One photo or video of a project, as its owner manages it. */
export type ProjectMedia = {
  kind: ProjectMediaKind;
  id: string;
  title: string;
  /** Photo: `pending` (bytes never arrived) or `ready`. Video: its processing state. */
  state: "pending" | "ready" | "uploading" | "processing" | "failed";
  isPublic: boolean;
  /** The owner's own short-lived preview (photo) or poster (video), or null. */
  previewUrl: string | null;
  /** Photos only: the opaque key the convergent delete needs. */
  objectKey: string | null;
  playback: VideoPlayback | null;
};

export type PortfolioProject = {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  isPublic: boolean;
  /** The chosen thumbnail, when it is still in the project; otherwise the first item. */
  cover: { kind: ProjectMediaKind; id: string } | null;
  media: ProjectMedia[];
};

/**
 * The caller's projects with their photos and videos in each project's order.
 * RLS returns only the caller's own rows; items keep the shared photo-and-video
 * sort_order, so a project's order is its items sorted by it.
 */
export async function loadMyPortfolioProjects(): Promise<PortfolioProject[]> {
  const supabase = await getServerSupabase();
  const [{ data: rows }, photos, videos] = await Promise.all([
    supabase.from("portfolio_projects")
      .select("id, title, location, description, visibility, cover_kind, cover_id, sort_order, created_at")
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true }),
    listMyPortfolio(),
    videoEnabled() ? listManagedVideos({ scope: "portfolio" }) : Promise.resolve([]),
  ]);

  type Ordered = ProjectMedia & { projectId: string; position: number; createdAt: string };
  const media: Ordered[] = [
    ...(await Promise.all(photos.filter((p) => p.projectId).map(async (p): Promise<Ordered> => {
      const source = p.pending ? null : await readableMediaSource(supabase, "portfolio", p.objectKey).catch(() => null);
      return { kind: "image", id: p.id, title: p.title, state: p.pending ? "pending" : "ready", isPublic: p.isPublic,
        previewUrl: source?.src ?? null, objectKey: p.objectKey, playback: null,
        projectId: p.projectId!, position: p.sortOrder, createdAt: p.createdAt };
    }))),
    ...videos.filter((v) => v.projectId).map((v): Ordered => ({
      kind: "video", id: v.id, title: v.title, state: v.state, isPublic: v.isPublic,
      previewUrl: v.playback?.poster ?? null, objectKey: null, playback: v.playback,
      projectId: v.projectId!, position: v.position ?? 0, createdAt: v.createdAt })),
  ].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return (rows ?? []).map((r) => {
    const own: ProjectMedia[] = media.filter((m) => m.projectId === r.id)
      .map((m) => ({ kind: m.kind, id: m.id, title: m.title, state: m.state, isPublic: m.isPublic,
        previewUrl: m.previewUrl, objectKey: m.objectKey, playback: m.playback }));
    const chosen = own.find((m) => m.kind === r.cover_kind && m.id === r.cover_id);
    const first = own[0];
    return {
      id: r.id, title: r.title, location: r.location, description: r.description,
      isPublic: r.visibility === "public",
      cover: chosen ? { kind: chosen.kind, id: chosen.id } : first ? { kind: first.kind, id: first.id } : null,
      media: own,
    };
  });
}

/** One published project as a visitor sees it. */
export type PublicPortfolioProject = {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  cover: { kind: ProjectMediaKind; id: string } | null;
  photos: PublicPortfolioItem[];
  videos: VideoPlayback[];
  /** Photos and videos together, in the owner's order. */
  order: { kind: ProjectMediaKind; id: string }[];
};

/**
 * Published projects of a listed profile, for `/p/[profileId]`. Like the flat
 * portfolio it returns nothing for an unlisted profile. Photos are fetched
 * through `/p/media/<id>` (or the media Worker), which re-proves publication;
 * videos only while video delivery is on.
 */
export async function loadPublicPortfolioProjects(profileId: string): Promise<PublicPortfolioProject[]> {
  const supabase = await getServerSupabase();
  const [projects, media, videos] = await Promise.all([
    supabase.rpc("public_portfolio_projects", { p_profile_id: profileId }),
    supabase.rpc("public_portfolio_project_media", { p_profile_id: profileId }),
    loadPublicPortfolioVideos(profileId),
  ]);
  if (projects.error || media.error) return [];
  const rows = (media.data ?? []).filter((m) => m.kind === "image" || videos.some((v) => v.id === m.id));
  const photoIds = rows.filter((m) => m.kind === "image").map((m) => m.id);
  const edge = await publicEdgeSources(supabase, "portfolio", photoIds);
  return (projects.data ?? []).flatMap((p) => {
    const own = rows.filter((m) => m.project_id === p.id);
    if (own.length === 0) return [];
    const cover = own.find((m) => m.kind === p.cover_kind && m.id === p.cover_id) ?? own[0]!;
    return [{
      id: p.id, title: p.title, location: p.location, description: p.description,
      cover: { kind: cover.kind as ProjectMediaKind, id: cover.id },
      photos: own.filter((m) => m.kind === "image").map((m) => ({ id: m.id, title: m.title, description: null,
        sortOrder: m.sort_order, media: publicPortfolioSource(m.id, edge.get(m.id)) })),
      videos: own.filter((m) => m.kind === "video").flatMap((m) => videos.filter((v) => v.id === m.id)),
      order: own.map((m) => ({ kind: m.kind as ProjectMediaKind, id: m.id })),
    }];
  });
}
