import { getServerSupabase } from "@/lib/supabase/server";
import { failure, json, refuseCrossSite } from "@/server/video/http";
import { completeVideoUpload } from "@/server/video/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Complete from the parts R2 holds, check size and signature, queue processing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  try {
    return json(await completeVideoUpload(await getServerSupabase(), (await params).id));
  } catch (error) { return failure(error); }
}
