import type { NextRequest } from "next/server";
import { serveViewMedia } from "@/server/view-as/media-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin View-As private portfolio video (HLS): `.../media/video/<videoId>/master.m3u8`, `360p/index.m3u8`, `360p/seg_00001.m4s`, ...
 * Relative playlist URIs resolve under this same path, so the browser never sees a storage key or a signed URL.
 * Range is supported; the whole contract lives in `server/view-as/media-delivery.ts`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; mediaId: string; file: string[] }> }) {
  const { id, mediaId, file } = await params;
  return serveViewMedia(request, { kind: "video", id, videoId: mediaId, file: file.join("/") });
}
