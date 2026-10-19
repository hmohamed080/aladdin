import { getServerSupabase } from "@/lib/supabase/server";
import { failure, json, readJson, refuseCrossSite } from "@/server/video/http";
import { beginSchema, beginVideoUpload, VideoUploadError } from "@/server/video/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start a video upload: the database decides, then R2 opens a multipart upload. */
export async function POST(request: Request) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    const parsed = beginSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new VideoUploadError("invalid");
    return json(await beginVideoUpload(await getServerSupabase(), parsed.data), 201);
  } catch (error) { return failure(error); }
}
