import { isUuid } from "./ticket";
import { PLAY_TICKET_TTL_SECONDS, signVideoTicket, verifyVideoTicket, type VideoTicketClaims } from "./video-ticket";
import type { ByteCacheLike, Env, ExecutionContextLike, MediaAuthority } from "./types";

/**
 * /v/<videoId>/<file>[?t=<ticket>]
 *
 *   master.m3u8                 adaptive master playlist
 *   poster.jpg                  poster frame
 *   <rendition>/index.m3u8      media playlist (360p | 720p | 1080p)
 *   <rendition>/init.mp4        fMP4 initialization segment
 *   <rendition>/seg_NNNNN.m4s   media segment
 *
 * EVERY request, segments included, asks the database (public.media_edge_video).
 * A ticket only binds a viewer and Auth session to a video; it carries no access
 * of its own. Without a ticket only a published portfolio video of a listed
 * profile is served. Delete, unpublish, delisting, suspension, sign-out and
 * product-audience changes therefore refuse the next segment.
 *
 * Playlists are rewritten so every URI carries a "play" ticket (minted here, up
 * to four hours) instead of the short "page" ticket the app issued; the rest of a
 * long video keeps loading. Only bytes are cached at the edge, keyed by the
 * video's immutable output revision; authorization never is.
 */
export type VideoGrant = { prefix: string; revision: string; renditions: string[]; poster: boolean; public: boolean };

const RENDITIONS = ["360p", "720p", "1080p"];
const FILE = /^(?:master\.m3u8|poster\.jpg|(360p|720p|1080p)\/(?:index\.m3u8|init\.mp4|seg_\d{5}\.m4s))$/;
const TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl", jpg: "image/jpeg", mp4: "video/mp4", m4s: "video/iso.segment",
};
const SECURITY = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
} as const;
const PRIVATE_CACHE = { "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store" } as const;
const PUBLIC_CACHE = { "cache-control": "private, no-cache", "cdn-cache-control": "no-store" } as const;
export const VIDEO_EDGE_CACHE_MAX_BYTES = 20 * 1024 * 1024;
const PLAYLIST_MAX_BYTES = 256 * 1024;

function log(reason: string) {
  console.log(JSON.stringify({ event: "media.denied", reason, mode: "v" }));
}

export function parseVideoGrant(value: unknown, videoId: string): VideoGrant | null {
  const g = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!g || typeof g !== "object") return null;
  const { prefix, revision, renditions, poster } = g as Record<string, unknown>;
  if (typeof revision !== "string" || !isUuid(revision) || prefix !== `video/${videoId}/${revision}/`) return null;
  if (!Array.isArray(renditions) || renditions.length === 0 || !renditions.every((r) => typeof r === "string" && RENDITIONS.includes(r))) return null;
  return { prefix, revision, renditions: renditions as string[], poster: poster === true, public: (g as { public?: unknown }).public === true };
}

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = (env.VIDEO_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return { vary: "origin" };
  return { "access-control-allow-origin": origin, "access-control-expose-headers": "content-length, content-range", vary: "origin" };
}

/** Appends the play ticket to every URI line and URI="..." attribute; refuses anything not a plain relative name. */
export function rewritePlaylist(text: string, master: boolean, renditions: readonly string[], ticket: string | null): string | null {
  const suffix = ticket ? `?t=${ticket}` : "";
  const allowedUri = (uri: string) => master
    ? renditions.some((r) => uri === `${r}/index.m3u8`)
    : /^(?:init\.mp4|seg_\d{5}\.m4s)$/.test(uri);
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") { out.push(line); continue; }
    if (line.startsWith("#")) {
      let bad = false;
      const rewritten = line.replace(/URI="([^"]*)"/g, (_m, uri: string) => {
        if (!allowedUri(uri)) bad = true;
        return `URI="${uri}${suffix}"`;
      });
      if (bad) return null;
      out.push(rewritten);
      continue;
    }
    if (!allowedUri(line)) return null;
    out.push(`${line}${suffix}`);
  }
  return out.join("\n");
}

type Range = { offset: number; length: number };
function parseRange(header: string | null, size: number): Range | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
}

export async function handleVideo(request: Request, env: Env, ctx: ExecutionContextLike, deps: {
  authority: () => MediaAuthority; keys: () => Map<string, Uint8Array<ArrayBuffer>>; now: () => number; cache: ByteCacheLike | null;
}): Promise<Response> {
  const url = new URL(request.url);
  const notFound = () => new Response(null, { status: 404, headers: { ...SECURITY, ...PRIVATE_CACHE, ...cors(request, env) } });
  if (request.method === "OPTIONS") {
    const headers = cors(request, env);
    if (!headers["access-control-allow-origin"]) return notFound();
    return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET, HEAD",
      "access-control-allow-headers": "range", "access-control-max-age": "600" } });
  }
  const match = /^\/v\/([0-9a-f-]{36})\/(.+)$/.exec(url.pathname);
  const tickets = url.searchParams.getAll("t");
  if (!match || !isUuid(match[1]) || !FILE.test(match[2]!) || tickets.length > 1
    || [...url.searchParams.keys()].some((k) => k !== "t")) { log("route"); return notFound(); }
  const videoId = match[1];
  const file = match[2]!;
  const now = Math.floor(deps.now() / 1000);

  let claims: VideoTicketClaims | null = null;
  if (tickets.length === 1) {
    claims = await verifyVideoTicket(tickets[0]!, deps.keys(), now);
    if (!claims || claims.vid !== videoId) { log("ticket"); return notFound(); }
  }
  const authority = deps.authority();
  try {
    const grant = parseVideoGrant(await authority.authorizeVideo({ video: videoId, viewer: claims?.sub ?? null,
      session: claims?.sid ?? null, workspace: claims?.ws ?? null, expiresAt: claims?.exp ?? null }), videoId);
    if (!grant) { log("authz"); return notFound(); }
    const rendition = file.includes("/") ? file.split("/")[0]! : null;
    if ((rendition && !grant.renditions.includes(rendition)) || (file === "poster.jpg" && !grant.poster)) { log("object"); return notFound(); }
    const objectKey = `${grant.prefix}${file}`;
    const ext = file.slice(file.lastIndexOf(".") + 1);
    const cache = claims ? PRIVATE_CACHE : PUBLIC_CACHE;
    const base = { ...SECURITY, ...cache, ...cors(request, env), "content-type": TYPES[ext]! };

    if (ext === "m3u8") {
      const object = await env.MEDIA_BUCKET.get(objectKey);
      if (!object || object.size > PLAYLIST_MAX_BYTES) { await object?.body.cancel(); log("object"); return notFound(); }
      const text = await new Response(object.body).text();
      // A page ticket becomes a play ticket at the master playlist; media playlists
      // pass the play ticket they were requested with.
      let ticket: string | null = null;
      if (claims) {
        if (claims.use === "play") ticket = tickets[0]!;
        else {
          const [kid, secret] = [...deps.keys()][0]!;
          ticket = await signVideoTicket(kid, secret, { ...claims, use: "play", exp: now + PLAY_TICKET_TTL_SECONDS });
        }
      }
      const body = rewritePlaylist(text, file === "master.m3u8", grant.renditions, ticket);
      if (body === null) { log("playlist"); return notFound(); }
      return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: base });
    }

    // Bytes: posters, init segments and media segments. Immutable per revision.
    const range = request.headers.get("range");
    const cacheKey = `https://media-edge.internal/${objectKey}?rev=${grant.revision}`;
    const cacheable = deps.cache !== null && env.EDGE_CACHE === "on" && !range && request.method === "GET";
    if (cacheable) {
      const hit = await deps.cache!.match(cacheKey).catch(() => undefined);
      if (hit?.body) {
        return new Response(hit.body, { status: 200, headers: { ...base, "accept-ranges": "bytes",
          "content-length": hit.headers.get("content-length") ?? "" } });
      }
    }
    let byteRange: Range | null = null;
    if (range || request.method === "HEAD") {
      const head = await env.MEDIA_BUCKET.head(objectKey);
      if (!head) { log("object"); return notFound(); }
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: { ...base, "accept-ranges": "bytes", "content-length": String(head.size) } });
      }
      const parsed = parseRange(range, head.size);
      if (parsed === "unsatisfiable") {
        return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${head.size}` } });
      }
      byteRange = parsed;
    }
    const object = await env.MEDIA_BUCKET.get(objectKey, byteRange ? { range: byteRange } : undefined);
    if (!object) { log("object"); return notFound(); }
    if (byteRange) {
      return new Response(object.body, { status: 206, headers: { ...base, "accept-ranges": "bytes",
        "content-length": String(byteRange.length),
        "content-range": `bytes ${byteRange.offset}-${byteRange.offset + byteRange.length - 1}/${object.size}` } });
    }
    const headers = { ...base, "accept-ranges": "bytes", "content-length": String(object.size) };
    if (cacheable && object.size <= VIDEO_EDGE_CACHE_MAX_BYTES) {
      const [toBrowser, toCache] = object.body.tee();
      ctx.waitUntil(deps.cache!.put(cacheKey, new Response(toCache, { headers: { "cache-control": "public, max-age=2592000, immutable",
        "content-type": TYPES[ext]!, "content-length": String(object.size) } })).catch(() => undefined));
      return new Response(toBrowser, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  } finally {
    ctx.waitUntil(authority.close().catch(() => undefined));
  }
}
