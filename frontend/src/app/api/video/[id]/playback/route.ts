import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { failure, json, refuseCrossSite } from "@/server/video/http";
import { VideoUploadError } from "@/server/video/uploads";
import { freshVideoSource } from "@/server/video/playback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = z.string().uuid();

/** A fresh playback URL, asked for when the viewer presses play or hovers. Never cached. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    const id = (await params).id;
    const ws = new URL(request.url).searchParams.get("ws");
    if (!UUID.safeParse(id).success || (ws !== null && !UUID.safeParse(ws).success)) throw new VideoUploadError("invalid");
    const src = await freshVideoSource(await getServerSupabase(), id, ws);
    if (!src) throw new VideoUploadError("unavailable");
    return json({ src });
  } catch (error) { return failure(error); }
}
