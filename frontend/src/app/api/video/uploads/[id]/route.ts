import { getServerSupabase } from "@/lib/supabase/server";
import { failure, json, refuseCrossSite } from "@/server/video/http";
import { videoUploadStatus } from "@/server/video/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resume: the parts R2 already holds for this upload. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    return json(await videoUploadStatus(await getServerSupabase(), (await params).id));
  } catch (error) { return failure(error); }
}
