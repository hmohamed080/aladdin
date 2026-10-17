import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { readPublicEnv } from "@/lib/env";
import { BV_BUCKET, isBvKey } from "@/lib/business-verification/contract";

export const dynamic = "force-dynamic";

/**
 * `/business-verification/file/<orgId>/<file>`: one verification document, streamed to its owner or to a
 * reviewer. No privilege of its own: the signature is minted as the caller, so the storage policy
 * (`app.can_read_bv_object`: org.manage on the organization, or a ready document and business-verification
 * review authority) is the only gate, and a refusal of any kind is the same 404. Nothing is cached.
 */
const CONTENT_TYPE: Readonly<Record<string, string>> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache", expires: "0" } as const;
const notFound = () => new NextResponse(null, { status: 404, headers: NO_STORE });

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string; fileName: string }> }) {
  const { orgId, fileName } = await params;
  const key = `${orgId}/${fileName}`;
  if (!isBvKey(key)) return notFound();

  const supabase = await getServerSupabase();
  const { data: signed, error } = await supabase.storage.from(BV_BUCKET).createSignedUrl(key, 30);
  if (error || !signed?.signedUrl) return notFound();
  const env = readPublicEnv();
  const url = signed.signedUrl.startsWith("http") ? signed.signedUrl : `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${signed.signedUrl}`;
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return notFound();

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "content-type": CONTENT_TYPE[key.slice(key.lastIndexOf(".") + 1)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "referrer-policy": "no-referrer",
    },
  });
}
