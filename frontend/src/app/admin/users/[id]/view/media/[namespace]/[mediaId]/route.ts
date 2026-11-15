import type { NextRequest } from "next/server";
import { serveViewMedia } from "@/server/view-as/media-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Admin View-As private image or certificate. The whole contract lives in `server/view-as/media-delivery.ts`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; namespace: string; mediaId: string }> }) {
  const { id, namespace, mediaId } = await params;
  return serveViewMedia(request, { kind: "image", id, namespace, mediaId });
}
