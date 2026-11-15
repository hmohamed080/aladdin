import type { NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isViewAsEnabled } from "@/lib/env/view-as";
import { can } from "@/lib/permissions/admin";
import { mediaPolicy } from "@/lib/storage/media-policy";
import { loadAdminAccess } from "@/server/authorization/admin";
import { consumeRateLimit } from "@/server/cache/rate-limit";
import { CloudflareR2StorageProvider } from "@/server/storage/r2-provider";
import { contentRangeMatches, parseContentRange, parseRangeHeader, unsatisfiedContentRange, upstreamRange } from "./range";

/**
 * Admin View-As private media delivery: the ONE implementation behind every view-media route
 * (`/admin/users/[id]/view/media/...` and `/view-as/[id]/media/...`).
 *
 * The browser only ever holds opaque media ids in the URL. The database is the only authority:
 *   - images/certificates: `admin_view_as_media_open` (ready object of the SUBJECT, verified R2 location);
 *   - videos (R2 + HLS): `admin_view_as_video_open` (ready portfolio video of the SUBJECT).
 * Both run `app.require_view_as` (permission, rank, a live view session bound to this Auth session), audit once per session and
 * media id without the key, and return the physical key (or video prefix) to THIS server code only. No service-role client and
 * none of the shared media resolvers (which still refuse an admin).
 *
 * Delivery: a 30 s signed R2 read, a redirect is never followed, the type is checked, the body is a size-bounded stream, no
 * upstream header is relayed, `private, no-store`, nosniff, and the authorization is repeated AFTER the fetch. For video the
 * whole check runs on EVERY request (playlist, init segment, each media segment, each Range), so Exit, expiry, sign-out or a
 * permission change stops playback at the next request and cuts one in flight.
 *
 * Range (video files only): exactly one `bytes=a-b | a- | -n`. Anything else is 416. The range asked upstream is clamped to
 * VIDEO_MAX_RESPONSE_BYTES, so a response is always bounded (a shorter 206 is valid). The upstream Content-Range is validated
 * against the request and re-emitted by us; a 200 where a 206 was asked for is refused.
 *
 * Only a same-origin subresource request is served (`Sec-Fetch-Site: same-origin`; a missing header fails closed). Referer and
 * Origin are never trusted and never consulted. Every refusal is the same empty 404 (416 only for a bad or unsatisfiable range
 * AFTER the caller is fully authorized, so it is no existence oracle).
 */

export const VIEW_MEDIA_NAMESPACES = ["avatar", "portfolio", "certificate"] as const;
type Namespace = (typeof VIEW_MEDIA_NAMESPACES)[number];

/** Largest body one video response may carry (a 200 or a clamped 206): 16 MiB, well above an HLS segment. */
export const VIDEO_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const PLAYLIST_MAX_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_FILE = /^(?:master\.m3u8|poster\.jpg|(360p|720p|1080p)\/(?:index\.m3u8|init\.mp4|seg_\d{5}\.m4s))$/;
const VIDEO_TYPES: Record<string, string> = { m3u8: "application/vnd.apple.mpegurl", jpg: "image/jpeg", mp4: "video/mp4", m4s: "video/iso.segment" };

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "cdn-cache-control": "no-store",
  pragma: "no-cache",
  expires: "0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;
const notFound = () => new Response(null, { status: 404, headers: NO_STORE });

export type ViewMediaTarget =
  | { kind: "image"; id: string; namespace: string; mediaId: string }
  | { kind: "video"; id: string; videoId: string; file: string };

type ImageGrant = { object: string; contentType: string };
type VideoGrant = { prefix: string; revision: string; renditions: string[]; poster: boolean };

function parseVideoGrant(data: unknown, videoId: string): VideoGrant | null {
  const g = data as Partial<VideoGrant> | null;
  if (!g || typeof g.prefix !== "string" || typeof g.revision !== "string" || !UUID.test(g.revision)) return null;
  if (g.prefix !== `video/${videoId}/${g.revision}/`) return null;
  if (!Array.isArray(g.renditions) || g.renditions.length === 0 || !g.renditions.every((r) => r === "360p" || r === "720p" || r === "1080p")) return null;
  return { prefix: g.prefix, revision: g.revision, renditions: g.renditions, poster: g.poster === true };
}

/** The playlist may only name plain relative files of this video (no scheme, no absolute path, no traversal). */
export function playlistIsSafe(text: string, master: boolean, renditions: readonly string[]): boolean {
  const allowed = (uri: string) => master ? renditions.some((r) => uri === `${r}/index.m3u8`) : /^(?:init\.mp4|seg_\d{5}\.m4s)$/.test(uri);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      for (const m of line.matchAll(/URI="([^"]*)"/g)) if (!allowed(m[1]!)) return false;
      continue;
    }
    if (!allowed(line)) return false;
  }
  return true;
}

export async function serveViewMedia(request: NextRequest, target: ViewMediaTarget): Promise<Response> {
  let upstream: Response | undefined;
  try {
    const video = target.kind === "video";
    if (!isViewAsEnabled() || !UUID.test(target.id)) return notFound();
    if (video ? !UUID.test(target.videoId) || !VIDEO_FILE.test(target.file)
      : !UUID.test(target.mediaId) || !(VIEW_MEDIA_NAMESPACES as readonly string[]).includes(target.namespace)) return notFound();
    if (request.method !== "GET") return notFound();   // GET only (a HEAD would fetch a body only to drop it)
    if (request.headers.get("sec-fetch-site") !== "same-origin") return notFound();

    const access = await loadAdminAccess();
    if (!access.isStaff || !can(access, "users.view_as")) return notFound();

    const client = await getServerSupabase();
    // Private media checks the session with Auth on every request (sign-out, ban and session revocation deny the next read).
    const { data: auth, error: authError } = await client.auth.getUser();
    const user = authError ? null : auth.user;
    if (!user) return notFound();
    // Images: one read per image shown (media-read, 1200/min). Video: a player makes many small requests (playlists, an init
    // segment and a segment every few seconds, plus Range probes), so it has its own, larger per-admin window (3000/min).
    const limited = await consumeRateLimit(video ? "view-video-read" : "media-read", user.id);
    if (limited.outcome === "limited") {
      return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds ?? 60), "Cache-Control": "no-store" } });
    }
    return video ? await serveVideo(request, client, target, (u) => { upstream = u; })
      : await serveImage(client, target, (u) => { upstream = u; });
  } catch {
    await upstream?.body?.cancel().catch(() => undefined);
    return notFound();
  }
}

type Client = Awaited<ReturnType<typeof getServerSupabase>>;

async function serveImage(client: Client, t: Extract<ViewMediaTarget, { kind: "image" }>, track: (u: Response) => void): Promise<Response> {
  const open = async (): Promise<ImageGrant | null> => {
    const { data, error } = await client.rpc("admin_view_as_media_open", { p_subject: t.id, p_namespace: t.namespace, p_media_id: t.mediaId });
    const o = data as Partial<ImageGrant> | null;
    return error || !o || typeof o.object !== "string" || !o.object || typeof o.contentType !== "string" ? null : { object: o.object, contentType: o.contentType };
  };
  const ns = t.namespace as Namespace;
  const before = await open();
  const policy = mediaPolicy(ns);
  if (!before || !(policy.types as readonly string[]).includes(before.contentType)) return notFound();

  const provider = new CloudflareR2StorageProvider(ns, "private", before.object);
  const url = await provider.getReadAccess(before.object, 30);
  // "manual", not "error": Workers throws on redirect "error". A 3xx is not ok, so it is never followed or served.
  const upstream = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000) });
  track(upstream);
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
  // No upstream ETag, Location, token, Set-Cookie or cache headers are forwarded.
  return new Response(bound(upstream.body, policy.maxBytes), { headers: { ...NO_STORE, "content-type": before.contentType, "content-disposition": "inline", "content-security-policy": "sandbox" } });
}

function bound(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let size = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > max) { controller.error(new Error("media stream limit")); return; }
      controller.enqueue(chunk);
    },
  }));
}

async function serveVideo(request: NextRequest, client: Client, t: Extract<ViewMediaTarget, { kind: "video" }>, track: (u: Response) => void): Promise<Response> {
  const open = async (): Promise<VideoGrant | null> => {
    const { data, error } = await client.rpc("admin_view_as_video_open", { p_subject: t.id, p_video_id: t.videoId });
    return error ? null : parseVideoGrant(data, t.videoId);
  };
  const ext = t.file.slice(t.file.lastIndexOf(".") + 1);
  const playlist = ext === "m3u8";
  // Playlists are small and always served whole (a Range on one is ignored, as HTTP allows).
  const range = playlist ? ({ kind: "none" } as const) : parseRangeHeader(request.headers.get("range"));

  const before = await open();
  if (!before) return notFound();
  const rendition = t.file.includes("/") ? t.file.split("/")[0]! : null;
  if ((rendition && !before.renditions.includes(rendition)) || (t.file === "poster.jpg" && !before.poster)) return notFound();
  // Authorized: only now is a bad Range answered as such (416), so a refusal never doubles as an existence oracle.
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...NO_STORE, "accept-ranges": "bytes" } });

  const key = `${before.prefix}${t.file}`;
  const provider = new CloudflareR2StorageProvider("portfolio", "private", key);
  const url = await provider.getReadAccess(key, 30);
  const ranged = range.kind !== "none";
  const upstream = await fetch(url, {
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000),
    method: "GET", headers: ranged ? { range: upstreamRange(range, VIDEO_MAX_RESPONSE_BYTES) } : undefined,
  });
  track(upstream);
  if (upstream.status === 416) {
    const unsatisfied = unsatisfiedContentRange(upstream.headers.get("content-range"));
    await upstream.body?.cancel();
    const still = await open();
    if (!still || still.prefix !== before.prefix) return notFound();
    return new Response(null, { status: 416, headers: { ...NO_STORE, "accept-ranges": "bytes", ...(unsatisfied ? { "content-range": unsatisfied } : {}) } });
  }
  const expected = ranged ? 206 : 200;
  if (upstream.status !== expected || !upstream.body) { await upstream.body?.cancel(); return notFound(); }

  const after = await open();
  if (!after || after.prefix !== before.prefix || after.revision !== before.revision) { await upstream.body.cancel(); return notFound(); }

  const max = playlist ? PLAYLIST_MAX_BYTES : VIDEO_MAX_RESPONSE_BYTES;
  const declared = upstream.headers.get("content-length");
  if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > max)) { await upstream.body.cancel(); return notFound(); }
  const base = { ...NO_STORE, "content-type": VIDEO_TYPES[ext]!, "content-disposition": "inline",
    "content-security-policy": "default-src 'none'; sandbox", "accept-ranges": "bytes" } as const;

  if (playlist) {
    const text = await new Response(bound(upstream.body, PLAYLIST_MAX_BYTES)).text();
    if (!playlistIsSafe(text, t.file === "master.m3u8", before.renditions)) return notFound();
    return new Response(text, { status: 200, headers: base });
  }
  if (!ranged) {
    if (declared === null) { await upstream.body.cancel(); return notFound(); }   // a full body must announce its (capped) size
    return new Response(bound(upstream.body, max), { status: 200, headers: { ...base, "content-length": declared } });
  }
  const got = parseContentRange(upstream.headers.get("content-range"));
  if (!got || !contentRangeMatches(got, range, VIDEO_MAX_RESPONSE_BYTES)) { await upstream.body.cancel(); return notFound(); }
  const length = got.end - got.start + 1;
  if (declared !== null && Number(declared) !== length) { await upstream.body.cancel(); return notFound(); }
  return new Response(bound(upstream.body, length), { status: 206, headers: { ...base,
    "content-range": `bytes ${got.start}-${got.end}/${got.total}`, "content-length": String(length) } });
}
