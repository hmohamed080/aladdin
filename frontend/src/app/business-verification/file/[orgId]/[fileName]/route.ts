import { getServerSupabase } from "@/lib/supabase/server";
import { isBvKey } from "@/lib/business-verification/contract";
import { deliverMedia, mediaNotFound } from "@/server/storage/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `/business-verification/file/<orgId>/<file>`: one verification document, streamed to its owner or to a
 * reviewer. The URL is unchanged; the bytes now come through the central media delivery (R2 for new
 * documents, Supabase Storage for legacy ones until they are retired or migrated). The database resolver
 * (`organization_media_resolve` -> `app.can_read_bv_object`: org.manage on the organization, or a ready
 * document and business-verification review authority) is the only gate, checked before and after the
 * fetch; any refusal is the same 404 and nothing is cached.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string; fileName: string }> }) {
  const { orgId, fileName } = await params;
  const key = `${orgId}/${fileName}`;
  if (!isBvKey(key)) return mediaNotFound();
  return deliverMedia(await getServerSupabase(), "verification", key);
}
