import type { NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isViewAsEnabled } from "@/lib/env/view-as";
import { can } from "@/lib/permissions/admin";
import { mediaPolicy } from "@/lib/storage/media-policy";
import { loadAdminAccess } from "@/server/authorization/admin";
import { consumeRateLimit } from "@/server/cache/rate-limit";
import { CloudflareR2StorageProvider } from "@/server/storage/r2-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The approved private-media allow-list (the database enforces the same list). */
const NAMESPACES = ["avatar", "portfolio", "certificate"] as const;
type Namespace = (typeof NAMESPACES)[number];

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "cdn-cache-control": "no-store",
  pragma: "no-cache",
  expires: "0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;
const notFound = () => new Response(null, { status: 404, headers: NO_STORE });

type Opened = { object: string; contentType: string };

/**
 * Admin View-As: one private file (avatar, portfolio image, certificate) of the account being viewed.
 *
 * The browser only ever holds the opaque media id in this URL. `admin_view_as_media_open` is the ONLY authority: it checks the
 * live, audited view session (users.view_as, eligibility and rank, unexpired, unended, bound to this Auth session), that the
 * media is a ready object of the subject with a verified R2 location, writes one audit row per session and media id, and
 * returns the physical key and content type to THIS server code. This route uses no service-role client and none of the
 * shared media resolvers (which still refuse an admin). It is the delivery pattern of the product's media route: a 30 s
 * signed read, no redirect followed, the type checked against the namespace policy, a size-bounded stream, no upstream
 * headers, `private, no-store`, nosniff, and the authorization repeated AFTER the fetch so Exit, expiry, sign-out or a
 * permission change cuts a file in flight. Nothing is public, copied or cached.
 *
 * Only a same-origin subresource or link request is served (`Sec-Fetch-Site: same-origin`); a missing header fails closed.
 * Every refusal is the same empty 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; namespace: string; mediaId: string }> }) {
  let upstream: Response | undefined;
  try {
    const { id, namespace, mediaId } = await params;
    if (!isViewAsEnabled() || !UUID.test(id) || !UUID.test(mediaId) || !(NAMESPACES as readonly string[]).includes(namespace)) return notFound();
    if (request.headers.get("sec-fetch-site") !== "same-origin") return notFound();

    const access = await loadAdminAccess();
    if (!access.isStaff || !can(access, "users.view_as")) return notFound();

    const client = await getServerSupabase();
    // Private media checks the session with Auth on every request (sign-out, ban and session revocation deny the next read).
    const { data: auth, error: authError } = await client.auth.getUser();
    const user = authError ? null : auth.user;
    if (!user) return notFound();
    const limited = await consumeRateLimit("media-read", user.id);
    if (limited.outcome === "limited") {
      return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds ?? 60), "Cache-Control": "no-store" } });
    }

    const open = async (): Promise<Opened | null> => {
      const { data, error } = await client.rpc("admin_view_as_media_open", { p_subject: id, p_namespace: namespace, p_media_id: mediaId });
      const o = data as Partial<Opened> | null;
      return error || !o || typeof o.object !== "string" || !o.object || typeof o.contentType !== "string" ? null : { object: o.object, contentType: o.contentType };
    };

    const ns = namespace as Namespace;
    const before = await open();
    const policy = mediaPolicy(ns);
    if (!before || !(policy.types as readonly string[]).includes(before.contentType)) return notFound();

    const provider = new CloudflareR2StorageProvider(ns, "private", before.object);
    const url = await provider.getReadAccess(before.object, 30);
    // "manual", not "error": Workers throws on redirect "error". A 3xx is not ok, so it is never followed or served.
    upstream = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); return notFound(); }

    const after = await open();
    if (!after || after.object !== before.object || after.contentType !== before.contentType) {
      await upstream.body.cancel();
      return notFound();
    }
    const length = upstream.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > policy.maxBytes)) {
      await upstream.body.cancel();
      return notFound();
    }
    let size = 0;
    const bounded = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > policy.maxBytes) { controller.error(new Error("media stream limit")); return; }
        controller.enqueue(chunk);
      },
    }));
    // No upstream ETag, Location, token, Set-Cookie or cache headers are forwarded.
    return new Response(bounded, { headers: { ...NO_STORE, "content-type": before.contentType, "content-disposition": "inline", "content-security-policy": "sandbox" } });
  } catch {
    await upstream?.body?.cancel().catch(() => undefined);
    return notFound();
  }
}
