import { NextResponse } from "next/server";
import { loadPublicMarketplaceImage } from "@/lib/supabase/admin-server";

export const dynamic = "force-dynamic";

/**
 * `/marketplace/media/<imageId>` — the only browser-facing contract for public
 * Marketplace product images (same byte-proxy shape as `/p/media/<itemId>`).
 *
 * Every request re-runs the full publication test in the database
 * (`marketplace_public_image_ref`): media flag on, image verified AND
 * byte-validated, product published, seller enabled, type and category active,
 * variant active. Unpublishing a product, suspending or revoking the seller,
 * rejecting the image, deleting it, or turning the media flag off makes the very
 * next request 404 — so nothing is stored by any cache (`no-store`). The browser
 * receives bytes only: no bucket, key, signed URL, or credential.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  pragma: "no-cache",
  expires: "0",
} as const;

function notFound() {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  if (!UUID.test(imageId)) return notFound();

  let image;
  try {
    image = await loadPublicMarketplaceImage(imageId);
  } catch {
    // missing service configuration or a storage failure: same answer as "not published"
    return notFound();
  }
  if (!image || !ALLOWED.has(image.mimeType)) return notFound();

  return new NextResponse(image.bytes, {
    status: 200,
    headers: {
      "content-type": image.mimeType,
      ...NO_STORE,
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "referrer-policy": "no-referrer",
    },
  });
}
