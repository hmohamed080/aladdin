import { describe, expect, it, vi } from "vitest";
import {
  edgeCopy,
  isCacheableLandingRequest,
  isCacheableLandingResponse,
  landingCacheKey,
  landingCacheSeconds,
  LANDING_BROWSER_CACHE_CONTROL,
  LANDING_CACHE_HEADER,
  serveLanding,
  type LandingCache,
} from "./landing-cache";

const HTML = "text/html; charset=utf-8";
const page = (over: { status?: number; headers?: Record<string, string> } = {}, body = "<html>landing</html>") =>
  new Response(body, {
    status: over.status ?? 200,
    headers: { "content-type": HTML, "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate", vary: "rsc, next-router-state-tree", ...over.headers },
  });
const visit = (path = "/", headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://aladdindecore.com${path}`, { method, headers: { accept: "text/html,application/xhtml+xml", ...headers } });

/** In-memory stand-in for `caches.default`, keyed by URL like the real one. */
function fakeCache() {
  const store = new Map<string, Response>();
  const cache: LandingCache = {
    async match(key) { return store.get(key.url)?.clone(); },
    async put(key, value) { store.set(key.url, value); },
  };
  return { cache, store };
}

async function serve(request: Request, cache: LandingCache, render: () => Promise<Response>, over: { version?: string | undefined; seconds?: number } = {}) {
  const pending: Promise<unknown>[] = [];
  const response = await serveLanding({
    request,
    cache,
    version: "version" in over ? over.version : "v1",
    seconds: over.seconds ?? 300,
    render,
    defer: (work) => pending.push(work),
  });
  await Promise.all(pending);
  return response;
}

describe("landingCacheSeconds", () => {
  it("is off unless the variable is a positive whole number", () => {
    for (const raw of [undefined, null, "", "0", "-5", "abc", "1.5", "5 minutes", 300, true]) expect(landingCacheSeconds(raw)).toBe(0);
    expect(landingCacheSeconds("300")).toBe(300);
    expect(landingCacheSeconds(" 60 ")).toBe(60);
  });

  it("never keeps the page longer than fifteen minutes", () => {
    expect(landingCacheSeconds("900")).toBe(900);
    expect(landingCacheSeconds("86400")).toBe(900);
  });
});

describe("isCacheableLandingRequest", () => {
  it("accepts only an anonymous browser load of /", () => {
    expect(isCacheableLandingRequest(visit("/"))).toBe(true);
  });

  it("refuses anything that is not exactly GET /", () => {
    expect(isCacheableLandingRequest(visit("/", {}, "POST"))).toBe(false);
    expect(isCacheableLandingRequest(visit("/", {}, "HEAD"))).toBe(false);
    for (const path of ["/auth/sign-in", "/explore", "/api/health", "/_next/image?url=%2Fa.jpg", "/?utm_source=x", "//", "/index"]) {
      expect(isCacheableLandingRequest(visit(path))).toBe(false);
    }
  });

  it("refuses a visitor who carries any cookie, credential or conditional header", () => {
    for (const header of ["cookie", "authorization", "range", "if-none-match", "if-modified-since"]) {
      expect(isCacheableLandingRequest(visit("/", { [header]: "x" }))).toBe(false);
    }
  });

  it("refuses Next.js client navigations, prefetches and Server Actions", () => {
    for (const header of ["rsc", "next-action", "next-url", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) {
      expect(isCacheableLandingRequest(visit("/", { [header]: "1" }))).toBe(false);
    }
  });

  it("needs an Accept that wants HTML", () => {
    expect(isCacheableLandingRequest(new Request("https://aladdindecore.com/", { headers: { accept: "application/json" } }))).toBe(false);
    expect(isCacheableLandingRequest(new Request("https://aladdindecore.com/"))).toBe(false);
    expect(isCacheableLandingRequest(visit("/", { accept: "TEXT/HTML" }))).toBe(true);
  });
});

describe("isCacheableLandingResponse", () => {
  it("accepts only a complete HTML page with no cookie", () => {
    expect(isCacheableLandingResponse(page())).toBe(true);
    expect(isCacheableLandingResponse(page({ status: 500 }))).toBe(false);
    expect(isCacheableLandingResponse(page({ status: 404 }))).toBe(false);
    expect(isCacheableLandingResponse(new Response("", { status: 302, headers: { location: "/x", "content-type": HTML } }))).toBe(false);
    expect(isCacheableLandingResponse(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))).toBe(false);
    expect(isCacheableLandingResponse(page({ headers: { "set-cookie": "sb-access=abc; Path=/" } }))).toBe(false);
  });
});

describe("landingCacheKey", () => {
  it("carries the host and the deployed version, and drops any query", () => {
    const key = landingCacheKey("https://aladdindecore.com/?utm=1", "v7");
    expect(key.url).toBe("https://aladdindecore.com/?__landing_version=v7");
    expect(landingCacheKey("https://www.aladdindecore.com/", "v7").url).not.toBe(key.url);
    expect(landingCacheKey("https://aladdindecore.com/", "v8").url).not.toBe(key.url);
  });
});

describe("edgeCopy", () => {
  it("keeps the page for the given time and drops Vary, without losing the body or other headers", async () => {
    const stored = edgeCopy(page({ headers: { link: "</a.woff2>; rel=preload" } }), 300);
    expect(stored.headers.get("cache-control")).toBe("public, max-age=300");
    expect(stored.headers.has("vary")).toBe(false);
    expect(stored.headers.get("link")).toBe("</a.woff2>; rel=preload");
    expect(stored.headers.get("content-type")).toBe(HTML);
    expect(await stored.text()).toBe("<html>landing</html>");
  });
});

describe("serveLanding", () => {
  it("renders on a miss, stores the page, and serves the next visitor from the edge", async () => {
    const { cache, store } = fakeCache();
    const render = vi.fn(async () => page());

    const first = await serve(visit(), cache, render);
    expect(first.headers.get(LANDING_CACHE_HEADER)).toBe("MISS");
    expect(await first.text()).toBe("<html>landing</html>");
    expect(render).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);

    const second = await serve(visit(), cache, render);
    expect(second.headers.get(LANDING_CACHE_HEADER)).toBe("HIT");
    expect(await second.text()).toBe("<html>landing</html>");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("tells browsers the same thing as a freshly rendered page, never the edge lifetime", async () => {
    const { cache, store } = fakeCache();
    await serve(visit(), cache, async () => page());
    expect([...store.values()][0]!.headers.get("cache-control")).toBe("public, max-age=300");
    const hit = await serve(visit(), cache, async () => page());
    expect(hit.headers.get("cache-control")).toBe(LANDING_BROWSER_CACHE_CONTROL);
    const miss = await serve(visit("/", {}), fakeCache().cache, async () => page());
    expect(miss.headers.get("cache-control")).toBe("private, no-cache, no-store, max-age=0, must-revalidate");
  });

  it("keeps a separate copy per deployed version", async () => {
    const { cache } = fakeCache();
    const render = vi.fn(async () => page());
    await serve(visit(), cache, render, { version: "v1" });
    const afterDeploy = await serve(visit(), cache, render, { version: "v2" });
    expect(afterDeploy.headers.get(LANDING_CACHE_HEADER)).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("never stores or serves a visitor who has cookies", async () => {
    const { cache, store } = fakeCache();
    await serve(visit(), cache, async () => page());
    const render = vi.fn(async () => page({}, "<html>for a signed-in visitor</html>"));
    const response = await serve(visit("/", { cookie: "sb-abc-auth-token=secret" }), cache, render);
    expect(response.headers.has(LANDING_CACHE_HEADER)).toBe(false);
    expect(await response.text()).toBe("<html>for a signed-in visitor</html>");
    expect(render).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it("does not store a page that sets a cookie, an error, or a redirect", async () => {
    for (const bad of [
      page({ headers: { "set-cookie": "sb=1" } }),
      page({ status: 500 }),
      new Response(null, { status: 307, headers: { location: "/auth/sign-in", "content-type": HTML } }),
    ]) {
      const { cache, store } = fakeCache();
      const response = await serve(visit(), cache, async () => bad);
      expect(response.headers.get(LANDING_CACHE_HEADER)).toBe("BYPASS");
      expect(store.size).toBe(0);
    }
  });

  it("passes every other URL and method straight to the app, untouched", async () => {
    for (const request of [visit("/explore"), visit("/auth/sign-in"), visit("/?x=1"), visit("/", {}, "POST")]) {
      const { cache, store } = fakeCache();
      const original = page();
      const response = await serve(request, cache, async () => original);
      expect(response).toBe(original);
      expect(response.headers.has(LANDING_CACHE_HEADER)).toBe(false);
      expect(store.size).toBe(0);
    }
  });

  it("is a no-op when switched off or when the Worker version is unknown", async () => {
    for (const over of [{ seconds: 0 }, { version: undefined }, { version: "" }]) {
      const { cache, store } = fakeCache();
      const original = page();
      const response = await serve(visit(), cache, async () => original, over);
      expect(response).toBe(original);
      expect(store.size).toBe(0);
    }
  });

  it("still serves the page when the cache fails to read or to write", async () => {
    const broken: LandingCache = {
      match: async () => { throw new Error("cache unavailable"); },
      put: async () => { throw new Error("cache full"); },
    };
    const response = await serve(visit(), broken, async () => page());
    expect(response.status).toBe(200);
    expect(response.headers.get(LANDING_CACHE_HEADER)).toBe("MISS");
    expect(await response.text()).toBe("<html>landing</html>");
  });
});
