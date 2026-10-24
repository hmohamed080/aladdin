"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { deleteProfessionalAsset } from "@/server/actions/professional-assets";
import { startPortfolioUpload, type UploadTicket } from "@/server/actions/portfolio";
import { deleteVideo } from "@/server/video/uploads";
import { isWithinDescriptionLimit } from "@/lib/text/description-limit";

/**
 * Portfolio projects: a titled group of at most 6 photos and videos, at most 15
 * per person (20261021090009_portfolio_projects.sql). The database enforces both
 * limits, ownership and the cover/order rules; these actions only validate input
 * early and name the refusal. Photos and videos are uploaded and removed through
 * the existing convergent sequences (server/actions/portfolio.ts, server/video).
 */

export type ProjectResult = { ok: true; id?: string } | { ok: false; code: ProjectErrorCode };
export type ProjectErrorCode =
  | "titleRequired" | "tooLong" | "projectLimit" | "mediaLimit" | "notProfessional" | "notFound" | "notEmpty" | "retry";

const TITLE_MAX = 120;
const LOCATION_MAX = 120;

type PgError = { code?: string; message?: string } | null;

function mapError(error: PgError): ProjectErrorCode {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("at most 15 projects")) return "projectLimit";
  if (msg.includes("at most 6 photos and videos")) return "mediaLimit";
  if (msg.includes("professional persona")) return "notProfessional";
  if (error?.code === "55000") return "notEmpty";
  if (error?.code === "23514") return "tooLong";
  if (error?.code === "42501") return "notFound";
  return "retry";
}

function refresh() {
  revalidatePath("/home/profile/edit");
  revalidatePath("/home/profile/portfolio");
  revalidatePath("/home/profile");
  // The dashboard banner's completion counts a portfolio project.
  revalidatePath("/home");
}

type Details = { title: string; location: string | null; description: string | null };

function checkDetails(input: Details): ProjectErrorCode | null {
  if (!input.title.trim()) return "titleRequired";
  if (input.title.trim().length > TITLE_MAX || (input.location?.trim().length ?? 0) > LOCATION_MAX
      || !isWithinDescriptionLimit(input.description)) return "tooLong";
  return null;
}

export async function createProjectAction(input: Details): Promise<ProjectResult> {
  const invalid = checkDetails(input);
  if (invalid) return { ok: false, code: invalid };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("portfolio_project_create", {
    p_title: input.title, p_location: input.location ?? "", p_description: input.description ?? "" });
  if (error || typeof data !== "string") return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true, id: data };
}

export async function updateProjectAction(projectId: string, input: Details): Promise<ProjectResult> {
  const invalid = checkDetails(input);
  if (invalid) return { ok: false, code: invalid };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_project_update", {
    p_project_id: projectId, p_title: input.title, p_location: input.location ?? "", p_description: input.description ?? "" });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

/**
 * Step one of a project photo: the existing pending-row-first upload, then the
 * row joins the project. A full project refuses it and the empty row is removed
 * at once (there are no bytes yet), exactly like a refused upload ticket.
 */
export async function startProjectPhotoUpload(projectId: string, input: { title: string; contentType: string; size: number }): Promise<UploadTicket> {
  const ticket = await startPortfolioUpload({ ...input, description: null });
  if (!ticket.ok) return ticket;
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_project_attach", { p_project_id: projectId, p_kind: "image", p_id: ticket.itemId });
  if (error) {
    await supabase.rpc("portfolio_item_delete", { p_item_id: ticket.itemId });
    await supabase.rpc("portfolio_item_purge", { p_item_id: ticket.itemId });
    return { ok: false, code: mapError(error) };
  }
  return ticket;
}

export async function setProjectCoverAction(projectId: string, kind: "image" | "video", id: string): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_project_set_cover", { p_project_id: projectId, p_kind: kind, p_id: id });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

/** Drag-and-drop order inside a project: the complete list, in the new order. */
export async function reorderProjectAction(projectId: string, items: { kind: "image" | "video"; id: string }[]): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_project_reorder", {
    p_project_id: projectId, p_items: items.map(({ kind, id }) => ({ kind, id })) });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

/** Drag-and-drop order of the projects themselves. */
export async function reorderProjectsAction(ids: string[]): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_projects_reorder", { p_ids: ids });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

export async function setProjectVisibilityAction(projectId: string, isPublic: boolean): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("portfolio_project_set_visibility", { p_project_id: projectId, p_public: isPublic });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

type MediaRef = { kind: "image" | "video"; id: string; objectKey?: string | null };

/** Removes one photo or video: visibility stops first, then the bytes, as everywhere else. */
async function removeMedia(supabase: Awaited<ReturnType<typeof getServerSupabase>>, item: MediaRef): Promise<PgError> {
  if (item.kind === "video") {
    try { await deleteVideo(supabase, item.id); return null; }
    catch { return { code: "42501" }; }
  }
  const { error } = await supabase.rpc("portfolio_item_delete", { p_item_id: item.id });
  if (error) return error;
  if (item.objectKey) {
    // Cleanup after visibility has already stopped; a failure leaves an invisible
    // `deleted` row that the same sequence completes later.
    const removed = await deleteProfessionalAsset("portfolio", item.objectKey);
    if (removed.ok) await supabase.rpc("portfolio_item_purge", { p_item_id: item.id });
  }
  return null;
}

export async function removeProjectMediaAction(item: MediaRef): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const error = await removeMedia(supabase, item);
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}

/**
 * Deletes a project with its photos and videos. The items are read from the
 * caller's own rows (never from the request), removed one by one, then the empty
 * project. A partial failure leaves the project in place, so running it again
 * finishes the job.
 */
export async function deleteProjectAction(projectId: string): Promise<ProjectResult> {
  const supabase = await getServerSupabase();
  const [photos, videos] = await Promise.all([
    supabase.from("portfolio_items").select("id, object_key").eq("project_id", projectId),
    supabase.from("media_videos").select("id").eq("project_id", projectId).neq("state", "deleted"),
  ]);
  if (photos.error || videos.error) return { ok: false, code: "retry" };
  for (const p of photos.data ?? []) {
    const error = await removeMedia(supabase, { kind: "image", id: p.id, objectKey: p.object_key });
    if (error) return { ok: false, code: mapError(error) };
  }
  for (const v of videos.data ?? []) {
    const error = await removeMedia(supabase, { kind: "video", id: v.id });
    if (error) return { ok: false, code: mapError(error) };
  }
  const { error } = await supabase.rpc("portfolio_project_delete", { p_project_id: projectId });
  if (error) return { ok: false, code: mapError(error) };
  refresh();
  return { ok: true };
}
