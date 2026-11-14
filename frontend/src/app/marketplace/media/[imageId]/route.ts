import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPublicMarketplaceImage } from "@/server/media/marketplace-image-bytes";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";

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
 *
 * While public edge delivery is on, the route hands over to the media Worker (Mode C, by image
 * id, with CDN caching and the recorded sizes): `?v=thumb|card|full` redirects to that size, the
 * Worker re-checking the same rule in the database on every request.
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

const SIZES = new Set(["thumb", "card", "full"]);

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  if (!UUID.test(imageId)) return notFound();

  const size = new URL(request.url).searchParams.get("v");
  try {
    const urls = (await marketplacePublicImageUrls(await getServerSupabase(), [imageId]))[imageId];
    const target = urls ? (size && SIZES.has(size) ? urls[size as "thumb" | "card" | "full"] ?? urls.src : urls.src) : null;
    if (target?.startsWith("https://")) return NextResponse.redirect(target, { status: 302, headers: NO_STORE });
  } catch {
    // edge lookup failed: serve the bytes from the application, as with the Worker off
  }

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
