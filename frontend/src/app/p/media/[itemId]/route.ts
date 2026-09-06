import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { readPublicEnv } from "@/lib/env";
import { ASSET_POLICY, isPortfolioObjectKey } from "@/lib/storage/professional-assets";

export const dynamic = "force-dynamic";

/**
 * `/p/media/<portfolioItemId>` — the ONLY browser-facing contract for public
 * portfolio media, and deliberately the only one.
 *
 * WHY A BYTE PROXY RATHER THAN A SIGNED URL IN THE PAGE. Everything else about a
 * signed URL is fine; the problem is that it necessarily contains the object key,
 * so handing one to the browser publishes whatever the key contains. Increment 11
 * made portfolio keys opaque, which removes the owner id from that exposure — and
 * proxying removes the exposure itself. The page emits an item id it already had,
 * and nothing about Storage reaches the client: no bucket, no key, no token, no
 * expiry, nothing to save and replay after the item is unpublished.
 *
 * NO PRIVILEGE OF ITS OWN. This runs as the caller — anon for a signed-out
 * visitor, which is the same identity the browser holds — and every step is one
 * the database would allow that caller to take directly:
 *
 *   1. `public_portfolio_media_key` returns a key ONLY for an item that is
 *      public, ready, and on a currently listed profile. Private items, pending
 *      items, deleted items, unlisted profiles and every certificate resolve to
 *      null, because certificates are not in that table at all.
 *   2. `professional_portfolio_select_published` then re-proves the same three
 *      conditions before Storage will sign anything. The check is duplicated on
 *      purpose: step 1 decides what to ask for, step 2 decides what may be served,
 *      and a bug in this file cannot widen step 2.
 *
 * So there is no service-role client, no new deployment secret, and no path
 * through here that a policy does not already permit.
 */

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every response from this route, including the refusals.
 *
 * A cached 404 is a bug in the other direction: publish a photograph and a
 * stored "not found" would keep it invisible for as long as the cache held it.
 * Publication and withdrawal both have to take effect on the next request, so
 * neither answer is storable.
 */
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  pragma: "no-cache",
  expires: "0",
} as const;

/** One refusal for every reason. See the comment on the resolver call below. */
function notFound() {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  // A malformed id is a miss, not a 500 — Postgres rejects a non-uuid comparison
  // outright, and a stale link should 404 like any other unknown item.
  if (!UUID.test(itemId)) return notFound();

  const supabase = await getServerSupabase();

  const { data: key, error } = await supabase.rpc("public_portfolio_media_key", {
    p_item_id: itemId,
  });
  // One answer for "not published", "not yours", "no such item" and "profile no
  // longer listed". A visitor must not be able to tell them apart, for the same
  // reason `loadPublicProfile` collapses its three cases into one 404.
  if (error || typeof key !== "string" || !isPortfolioObjectKey(key)) {
    return notFound();
  }

  // Thirty seconds, and it never leaves this process: the URL is minted, fetched
  // once on the line below, and discarded. It is deliberately far shorter than a
  // reader-facing URL would be, because the only thing it has to outlive is one
  // server-to-storage round trip on the same network.
  const { data: signed, error: signError } = await supabase.storage
    .from(ASSET_POLICY.portfolio.bucket)
    .createSignedUrl(key, 30);
  if (signError || !signed?.signedUrl) return notFound();

  const env = readPublicEnv();
  const url = signed.signedUrl.startsWith("http")
    ? signed.signedUrl
    : `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${signed.signedUrl}`;

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) return notFound();

  const extension = key.slice(key.lastIndexOf(".") + 1);
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
      /**
       * NO STORE. Not "briefly cached" — not stored at all.
       *
       * An earlier version allowed 60 seconds, on the reasoning that the item
       * vanishes from the page the moment it is unpublished so only a saved media
       * URL could exploit the gap. That reasoning describes the exploit rather
       * than preventing it: a saved `/p/media/<id>` is precisely what somebody
       * keeps, and for up to a minute after a person unpublished a photograph —
       * or after the platform delisted their profile — a cache would keep serving
       * it. Withdrawal that is "immediate except for a minute" is not immediate.
       *
       * So every single request re-runs the full publication test: the resolver
       * returns a key only for a public, ready item on a currently listed
       * profile, and the storage policy proves the same three conditions again
       * before Storage will sign anything. The cost is one round trip per image
       * per view, which is the correct price for a withdrawal a person can rely
       * on. `no-store` also covers shared caches and the browser's back/forward
       * cache, which `max-age=0` alone would not.
       */
      ...NO_STORE,
      // The bytes are a photograph, and nothing here should ever be interpreted
      // as a document by a browser that disagrees with our content type.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      // Nothing downstream needs to know where these bytes came from, and a
      // referrer carrying the item id onto a third-party host is a disclosure
      // with no purpose.
      "referrer-policy": "no-referrer",
    },
  });
}
