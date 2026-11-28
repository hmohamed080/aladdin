import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { VIDEO_TITLE_MAX } from "@/lib/media/video-policy";
import { failure, json, readJson, refuseCrossSite } from "@/server/video/http";
import { deleteVideo, updateVideo, VideoUploadError } from "@/server/video/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const changeSchema = z.object({ title: z.string().max(VIDEO_TITLE_MAX).optional(), isPublic: z.boolean().optional() })
  .refine((c) => c.title !== undefined || c.isPublic !== undefined);

/** Rename, publish or unpublish. Unpublishing denies the next playback request. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    const parsed = changeSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new VideoUploadError("invalid");
    await updateVideo(await getServerSupabase(), (await params).id, parsed.data);
    return json({ ok: true });
  } catch (error) { return failure(error); }
}

/** Delete: playback stops on the next request; the bytes are purged afterwards. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    await deleteVideo(await getServerSupabase(), (await params).id);
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
