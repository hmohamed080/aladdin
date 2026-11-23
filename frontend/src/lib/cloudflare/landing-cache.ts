/**
 * Edge cache for the anonymous public Landing page (`/`), used by the Worker entry (`cloudflare/worker.ts`).
 *
 * Why: `/` is `force-dynamic` and the root layout reads cookies, so Next sends `private, no-store` and every visit
 * renders the whole page in the Worker (about 240 ms of CPU, plus a cold start on a quiet site). For a visitor with NO
 * cookies the page is the same for everyone (the only moving part is the platform counts, which already tolerate being
 * minutes old: `landing-brand-stats.server.ts`), so the rendered HTML can be reused for a few minutes.
 *
 * What it is NOT: a zone-wide "cache everything" rule (the 2026-10-22 audit says none may exist). It is one URL, one
 * method, and only when the request carries nothing that could make the page personal. Everything else goes straight
 * to the app, untouched.
 *
 * Safety rules, each covered by landing-cache.test.ts:
 *   - request: GET `/` with no query string, no Cookie / Authorization / Range / conditional headers, no Next RSC,
 *     prefetch or Server Action headers, and an `Accept` that wants HTML;
 *   - response: 200 `text/html` with no `Set-Cookie`; anything else is passed through and never stored;
 *   - the key carries the deployed Worker version, so a deploy never serves HTML that points at chunks it replaced;
 *   - off unless LANDING_EDGE_CACHE_SECONDS is a positive number (capped at 15 minutes): the switch to turn it off;
 *   - browsers still receive the app's own `private, no-store` header: only the edge keeps a copy.
 */

/** Response header that says what happened, so a hosted check can tell a hit from a miss (`HIT`, `MISS`, `BYPASS`). */
export const LANDING_CACHE_HEADER = "x-landing-cache";

/** What browsers are told on a hit: the same as a freshly rendered page. */
export const LANDING_BROWSER_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

const MAX_SECONDS = 15 * 60;

/** Request headers whose presence means the answer could differ per visitor, or is not a plain page load. */
const NOT_ANONYMOUS_PAGE_LOAD = [
  "cookie",
  "authorization",
  "range",
  "if-none-match",
  "if-modified-since",
  "rsc",
  "next-action",
  "next-url",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
];

/** The subset of the Workers Cache API this module uses (`caches.default`). */
export type LandingCache = {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
};

/** Seconds the edge may keep the page. 0 (off) for a missing, non-numeric or non-positive value; never above 15 minutes. */
export function landingCacheSeconds(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const text = raw.trim();
  if (!/^\d{1,6}$/.test(text)) return 0;
  return Math.min(Number(text), MAX_SECONDS);
}

/** True only for an anonymous, plain browser load of the Landing page. */
export function isCacheableLandingRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname !== "/" || url.search !== "") return false;
  if (NOT_ANONYMOUS_PAGE_LOAD.some((name) => request.headers.has(name))) return false;
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/html");
}

/** True only for a complete HTML page that sets no cookie. */
export function isCacheableLandingResponse(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.headers.has("set-cookie")) return false;
  return (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");
}

/** Cache key: the page URL (host included) plus the deployed Worker version. */
export function landingCacheKey(url: string, version: string): Request {
  const key = new URL(url);
  key.search = "";
  key.searchParams.set("__landing_version", version);
  return new Request(key.toString(), { method: "GET" });
}

/** The copy the edge stores: kept for `seconds`, with `Vary` removed (the Cache API only understands Accept-Encoding). */
export function edgeCopy(response: Response, seconds: number): Response {
  const copy = new Response(response.body, response);
  copy.headers.set("cache-control", `public, max-age=${seconds}`);
  copy.headers.delete("vary");
  return copy;
}

function withCacheState(response: Response, state: "HIT" | "MISS" | "BYPASS", cacheControl?: string): Response {
  // Headers of a fetched or cached Response are immutable: copy before changing them.
  const copy = new Response(response.body, response);
  copy.headers.set(LANDING_CACHE_HEADER, state);
  if (cacheControl) copy.headers.set("cache-control", cacheControl);
  return copy;
}

/**
 * Serves `/` from the edge copy when there is one, else renders it and stores the result for `seconds`.
 * Any request that is not an anonymous page load of `/` (or when the feature is off, or the Worker version is
 * unknown) is rendered exactly as before, with no header added.
 */
export async function serveLanding(options: {
  request: Request;
  cache: LandingCache;
  /** The deployed Worker version id; without it the key could outlive a deploy, so nothing is cached. */
  version: string | undefined;
  seconds: number;
  render: () => Promise<Response>;
  /** `ctx.waitUntil`: the store happens after the response has been sent. */
  defer: (work: Promise<unknown>) => void;
}): Promise<Response> {
  const { request, cache, version, seconds, render, defer } = options;
  if (seconds <= 0 || !version || !isCacheableLandingRequest(request)) return render();

  const key = landingCacheKey(request.url, version);
  // A failing cache read must never take the page down: treat it as a miss.
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return withCacheState(hit, "HIT", LANDING_BROWSER_CACHE_CONTROL);

  const response = await render();
  if (!isCacheableLandingResponse(response)) return withCacheState(response, "BYPASS");
  defer(cache.put(key, edgeCopy(response.clone(), seconds)).catch(() => undefined));
  return withCacheState(response, "MISS");
}
