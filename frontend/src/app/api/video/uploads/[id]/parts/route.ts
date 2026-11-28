import { getServerSupabase } from "@/lib/supabase/server";
import { failure, json, readJson, refuseCrossSite } from "@/server/video/http";
import { partsSchema, signVideoParts, VideoUploadError } from "@/server/video/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Signed R2 URLs for up to eight parts, each bound to its part number and length. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    const parsed = partsSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new VideoUploadError("invalid");
    return json({ urls: await signVideoParts(await getServerSupabase(), (await params).id, parsed.data.parts) });
  } catch (error) { return failure(error); }
}
