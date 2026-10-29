import { isUuid, parseTicketKeys, verifyTicket, VARIANTS } from "./ticket";
import type { ByteCacheLike, Env, ExecutionContextLike, MediaAuthority, MediaGrant } from "./types";
import { handleVideo } from "./video";

// Content types the application accepts per namespace (frontend/src/lib/storage/media-policy.ts).
const TYPES: Record<string, readonly string[]> = {
  avatar: ["image/jpeg", "image/png", "image/webp"],
  portfolio: ["image/jpeg", "image/png", "image/webp"],
  certificate: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  product: ["image/jpeg", "image/png", "image/webp"],
  organization: ["image/jpeg", "image/png", "image/webp"],
};
const PUBLIC_NAMESPACES = ["portfolio", "avatar"];

const SECURITY = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
  "content-disposition": "inline",
} as const;
const PRIVATE_CACHE = { "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store", pragma: "no-cache" } as const;
// Mode C: browsers may keep bytes but must revalidate every view; each revalidation is re-authorized.
const CONDITIONAL_CACHE = { "cache-control": "private, no-cache", "cdn-cache-control": "no-store" } as const;

/** One answer for missing, denied, malformed and failed: no existence oracle. */
export function notFound(): Response {
  return new Response(null, { status: 404, headers: { ...SECURITY, ...PRIVATE_CACHE } });
}

function log(reason: string, mode: string) {
  // Never log keys, ids or tickets: reason/mode are a closed set used for alerting.
  console.log(JSON.stringify({ event: "media.denied", reason, mode }));
}

// Ids-only keys of uploads made from 2026-10-29 (migration 20261029090001), per namespace:
// <u|o>/<owner id>/<folder>/[<product id>/]<media id>/(original.<ext> | v/<variant>.webp).
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID_KEY_FOLDERS: Record<string, string> = {
  avatar: `u/${ID}/profile/${ID}`,
  portfolio: `u/${ID}/portfolio/${ID}`,
  certificate: `u/${ID}/certificates/${ID}`,
  product: `[uo]/${ID}/products/${ID}/${ID}`,
  organization: `o/${ID}/profile/${ID}`,
};
const ID_KEYS = Object.fromEntries(Object.entries(ID_KEY_FOLDERS).map(([namespace, folder]) =>
  [namespace, new RegExp(`^${folder}/(original\\.[a-z0-9]{2,5}|v/(thumb|card|full)\\.webp)$`)]));

/** True for a variant object; false for an original; null when the key does not belong to the namespace. */
function objectKind(object: string, namespace: string): boolean | null {
  if (object.startsWith(`${namespace}/`)) return false;
  if (object.startsWith(`v/${namespace}/`)) return true;
  const m = ID_KEYS[namespace]?.exec(object);
  return m ? m[2] !== undefined : null;
}

function parseGrant(value: unknown, namespace: string): MediaGrant | null {
  const g = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!g || typeof g !== "object") return null;
  const { object, contentType, size, sha256 } = g as Record<string, unknown>;
  if (typeof object !== "string" || object.includes("..") || object.length > 300) return null;
  const variant = objectKind(object, namespace);
  if (variant === null) return null;
  const allowed = variant ? ["image/webp"] : TYPES[namespace] ?? [];
  if (typeof contentType !== "string" || !allowed.includes(contentType)) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const n = typeof size === "string" ? Number(size) : size;
  if (!(n === null || (typeof n === "number" && Number.isSafeInteger(n) && n > 0))) return null;
  return { object, contentType, size: n, sha256 };
}

type ByteRange = { offset: number; length: number } | "unsatisfiable" | null;

// Objects up to this size are kept in the edge byte cache (images and most PDFs).
export const EDGE_CACHE_MAX_BYTES = 20 * 1024 * 1024;
const EDGE_CACHE_CONTROL = "public, max-age=2592000, immutable";

/**
 * Content-addressed cache key: the R2 object plus the verified sha256. A replaced
 * object gets a new sha256 and therefore a new key, so a cached entry is never
 * stale. The key is internal to the Worker and never sent to a browser.
 */
export function edgeCacheKey(grant: MediaGrant): string {
  return `https://media-edge.internal/${grant.object}?sha256=${grant.sha256}`;
}

/** A single `bytes=` range against a known size; anything else serves the whole object. */
export function parseRange(header: string | null, size: number | null): ByteRange {
  if (!header || size === null) return null;
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

async function serve(request: Request, env: Env, ctx: ExecutionContextLike, bytes: ByteCacheLike | null,
  grant: MediaGrant, conditional: boolean): Promise<Response> {
  const etag = `"${grant.sha256}"`;
  const cache = conditional ? { ...CONDITIONAL_CACHE, etag } : PRIVATE_CACHE;
  const base = { ...SECURITY, ...cache, "content-type": grant.contentType, "accept-ranges": "bytes" };
  if (conditional) {
    const inm = request.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return new Response(null, { status: 304, headers: { ...SECURITY, ...cache } });
    }
  }
  const ifRange = request.headers.get("if-range");
  const range = ifRange && (!conditional || ifRange.trim() !== etag) ? null : parseRange(request.headers.get("range"), grant.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${grant.size}` } });
  }
  if (request.method === "HEAD") {
    const head = await env.MEDIA_BUCKET.head(grant.object);
    if (!head || (grant.size !== null && head.size !== grant.size)) { log("object", conditional ? "c" : "m"); return notFound(); }
    return new Response(null, { status: 200, headers: { ...base, "content-length": String(head.size) } });
  }
  // Edge byte cache: only whole-object GETs of a known, bounded size. The response
  // the browser receives keeps its private headers; only the stored copy is public.
  const cacheable = bytes !== null && env.EDGE_CACHE === "on" && !range && grant.size !== null
    && grant.size <= EDGE_CACHE_MAX_BYTES;
  const key = edgeCacheKey(grant);
  if (cacheable) {
    const hit = await bytes.match(key).catch(() => undefined);
    if (hit?.body && Number(hit.headers.get("content-length")) === grant.size) {
      return new Response(hit.body, { status: 200, headers: { ...base, "content-length": String(grant.size) } });
    }
    await hit?.body?.cancel();
  }
  const object = await env.MEDIA_BUCKET.get(grant.object, range ? { range } : undefined);
  // A size mismatch means the object is not the verified receipt: refuse it.
  if (!object || (grant.size !== null && object.size !== grant.size)) {
    await object?.body.cancel();
    log("object", conditional ? "c" : "m");
    return notFound();
  }
  if (range) {
    return new Response(object.body, { status: 206, headers: { ...base, "content-length": String(range.length),
      "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}` } });
  }
  if (cacheable) {
    const [toBrowser, toCache] = object.body.tee();
    ctx.waitUntil(bytes.put(key, new Response(toCache, { headers: { "cache-control": EDGE_CACHE_CONTROL,
      "content-type": grant.contentType, "content-length": String(object.size) } })).catch(() => undefined));
    return new Response(toBrowser, { status: 200, headers: { ...base, "content-length": String(object.size) } });
  }
  return new Response(object.body, { status: 200, headers: { ...base, "content-length": String(object.size) } });
}

export type HandlerDeps = {
  authority: (env: Env) => MediaAuthority;
  now: () => number;
  /** The edge byte cache, or null where none exists (tests, previews). */
  cache?: () => ByteCacheLike | null;
};

/**
 * Routes:
 *   /m/<ns>/<variant>?t=<ticket>   private (Mode P): ticket + database authorization
 *   /c/<ns>/<id>/<variant>         conditional public (Mode C): database eligibility
 *   /v/<videoId>/<file>[?t=]       video playlists, segments and posters (video.ts)
 * Every request reaches the database; nothing about authorization is cached here.
 */
export function createHandler(deps: HandlerDeps) {
  let cachedKeys: { source: string; keys: Map<string, Uint8Array<ArrayBuffer>> } | null = null;
  const keysFor = (env: Env) => {
    if (cachedKeys?.source !== env.TICKET_KEYS) cachedKeys = { source: env.TICKET_KEYS, keys: parseTicketKeys(env.TICKET_KEYS) };
    return cachedKeys.keys;
  };
  return async function fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/v/") && env.VIDEO_ROUTES === "on"
      && (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS")) {
      try {
        return await handleVideo(request, env, ctx, { authority: () => deps.authority(env), keys: () => keysFor(env),
          now: deps.now, cache: deps.cache?.() ?? null });
      } catch {
        log("error", "v");
        return notFound();
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return notFound();
    const parts = url.pathname.split("/");
    let authority: MediaAuthority | null = null;
    try {
      if (parts.length === 4 && parts[1] === "m" && env.PRIVATE_ROUTES === "on") {
        const [, , namespace, variant] = parts as [string, string, string, string];
        const tickets = url.searchParams.getAll("t");
        if ([...url.searchParams.keys()].some((k) => k !== "t") || tickets.length !== 1) { log("route", "m"); return notFound(); }
        const now = Math.floor(deps.now() / 1000);
        const claims = await verifyTicket(tickets[0]!, keysFor(env), now);
        if (!claims || claims.ns !== namespace || claims.var !== variant) { log("ticket", "m"); return notFound(); }
        authority = deps.authority(env);
        const grant = parseGrant(await authority.authorizePrivate({ namespace: claims.ns, key: claims.k, variant: claims.var,
          viewer: claims.sub, session: claims.sid, workspace: claims.ws, expiresAt: claims.exp }), claims.ns);
        if (!grant) { log("authz", "m"); return notFound(); }
        return await serve(request, env, ctx, deps.cache?.() ?? null, grant, false);
      }
      if (parts.length === 5 && parts[1] === "c" && env.PUBLIC_ROUTES === "on") {
        const [, , namespace, id, variant] = parts as [string, string, string, string, string];
        if (!PUBLIC_NAMESPACES.includes(namespace) || !isUuid(id) || !(VARIANTS as readonly string[]).includes(variant)
          || url.search !== "") { log("route", "c"); return notFound(); }
        authority = deps.authority(env);
        const grant = parseGrant(await authority.authorizePublic({ namespace, id, variant }), namespace);
        if (!grant) { log("authz", "c"); return notFound(); }
        return await serve(request, env, ctx, deps.cache?.() ?? null, grant, true);
      }
      log("route", "-");
      return notFound();
    } catch {
      log("error", parts[1] === "c" ? "c" : "m");
      return notFound();
    } finally {
      if (authority) ctx.waitUntil(authority.close().catch(() => undefined));
    }
  };
}

