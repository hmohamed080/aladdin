import { beforeEach, describe, expect, it } from "vitest";
import vectors from "./ticket-vectors.json";
import { createHandler, parseRange } from "../src/handler";
import { parseTicketKeys, signTicket, type TicketClaims } from "../src/ticket";
import type { Env, MediaAuthority, R2BucketLike } from "../src/types";

const NOW = vectors.now;
const keys = parseTicketKeys(JSON.stringify(vectors.keys));
const VIEWER = "70000009-0000-4000-8000-000000000009";
const SESSION = "e9000000-0000-4000-8000-000000000001";
const ITEM = "e9100000-0000-4000-8000-000000000001";
const KEY = `${VIEWER}/e9100000-0000-4000-8000-000000000002.pdf`;
const BYTES = new TextEncoder().encode("%PDF-1.7 private certificate bytes");
const SHA = "b".repeat(64);

/** In-memory stand-in for the database's current state; tests mutate it to revoke. */
type Db = { deleted: boolean; suspended: boolean; sessionRevoked: boolean; published: boolean; grant: Record<string, unknown> | null };
let db: Db;
let calls: { private: number; public: number; closed: number };

function fakeAuthority(): MediaAuthority {
  return {
    async authorizePrivate(r) {
      calls.private++;
      // Mirrors media_edge_authorize: owner + session + active + not deleted + unexpired.
      if (db.deleted || db.suspended || db.sessionRevoked || r.viewer !== VIEWER || r.session !== SESSION
        || r.key !== KEY || r.expiresAt < NOW - 5) return null;
      return db.grant;
    },
    async authorizePublic(r) {
      calls.public++;
      if (!db.published || db.deleted || db.suspended || r.id !== ITEM) return null;
      return { object: "portfolio/e9100000-0000-4000-8000-000000000001.png", contentType: "image/png", size: 4, sha256: "a".repeat(64) };
    },
    async authorizeVideo() { return null; },
    async close() { calls.closed++; },
  };
}

function bucket(objects: Record<string, Uint8Array<ArrayBuffer>>): R2BucketLike {
  return {
    async get(key, options) {
      const bytes = objects[key];
      if (!bytes) return null;
      const slice = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
      return { size: bytes.length, body: new Blob([slice]).stream() };
    },
    async head(key) { const b = objects[key]; return b ? { size: b.length } : null; },
  };
}

let env: Env;
const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
const handle = createHandler({ authority: () => fakeAuthority(), now: () => NOW * 1000 });

beforeEach(() => {
  db = { deleted: false, suspended: false, sessionRevoked: false, published: true,
    grant: { object: `certificate/${KEY}`, contentType: "application/pdf", size: BYTES.length, sha256: SHA } };
  calls = { private: 0, public: 0, closed: 0 };
  env = {
    MEDIA_BUCKET: bucket({ [`certificate/${KEY}`]: BYTES, "portfolio/e9100000-0000-4000-8000-000000000001.png": new Uint8Array([137, 80, 78, 71]) }),
    HYPERDRIVE: { connectionString: "postgres://unused" }, TICKET_KEYS: JSON.stringify(vectors.keys),
    PRIVATE_ROUTES: "on", PUBLIC_ROUTES: "on",
  };
});

const claims = (over: Partial<TicketClaims> = {}): TicketClaims =>
  ({ v: 1, ns: "certificate", k: KEY, var: "original", sub: VIEWER, sid: SESSION, ws: null, exp: NOW + 90, ...over });
async function privateUrl(over: Partial<TicketClaims> = {}, path = "/m/certificate/original") {
  return `https://media.example.test${path}?t=${await signTicket("k1", keys.get("k1")!, claims(over))}`;
}
const get = (url: string, headers: Record<string, string> = {}, method = "GET") => handle(new Request(url, { method, headers }), env, ctx);

describe("Mode P: private delivery", () => {
  it("streams the authorized object with private no-store headers", async () => {
    const res = await get(await privateUrl());
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(calls.private).toBe(1);
    await Promise.all(waits);
    expect(calls.closed).toBe(1);
  });

  it("authorizes EVERY request: a ticket minted before revocation is refused next time", async () => {
    const url = await privateUrl();
    for (const revoke of [() => { db.deleted = true; }, () => { db.suspended = true; }, () => { db.sessionRevoked = true; }]) {
      db.deleted = db.suspended = db.sessionRevoked = false;
      expect((await get(url)).status).toBe(200);
      revoke();
      const denied = await get(url);
      expect(denied.status).toBe(404);
      expect(denied.headers.get("cache-control")).toContain("no-store");
    }
    expect(calls.private).toBe(6);
  });

  it("gives one indistinguishable 404 for denied, missing and malformed", async () => {
    const shape = async (r: Response) => ({ s: r.status, h: [...r.headers.entries()].sort(), b: await r.text() });
    db.grant = null;
    const denied = await shape(await get(await privateUrl()));
    db.grant = { object: `certificate/${VIEWER}/00000000-0000-4000-8000-000000000000.pdf`, contentType: "application/pdf", size: 10, sha256: SHA };
    const missing = await shape(await get(await privateUrl()));
    const forged = await shape(await get("https://media.example.test/m/certificate/original?t=k1.e30.AAAA"));
    expect(missing).toEqual(denied);
    expect(forged).toEqual(denied);
  });

  it("never reaches the database for a forged, expired, foreign-key or mis-bound ticket", async () => {
    const tampered = (await privateUrl()).replace(/\.([A-Za-z0-9_-]+)$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const wrongKey = `https://media.example.test/m/certificate/original?t=${await signTicket("k1", new Uint8Array(32).fill(7), claims())}`;
    for (const url of [tampered, wrongKey, await privateUrl({ exp: NOW - 30 }), await privateUrl({}, "/m/portfolio/original"),
      await privateUrl({}, "/m/certificate/thumb"), `${await privateUrl()}&x=1`]) {
      expect((await get(url)).status).toBe(404);
    }
    expect(calls.private).toBe(0);
  });

  it("refuses the ticket of another viewer: the database binds viewer and session", async () => {
    expect((await get(await privateUrl({ sub: "70000003-0000-4000-8000-000000000003" }))).status).toBe(404);
    expect((await get(await privateUrl({ sid: "e9000000-0000-4000-8000-000000000002" }))).status).toBe(404);
  });

  it("refuses an object that is not the verified receipt (size mismatch) or an unsafe grant", async () => {
    db.grant = { ...db.grant!, size: BYTES.length + 1 };
    expect((await get(await privateUrl())).status).toBe(404);
    for (const grant of [{ object: `certificate/${KEY}`, contentType: "text/html", size: BYTES.length, sha256: SHA },
      { object: `portfolio/${KEY}`, contentType: "application/pdf", size: BYTES.length, sha256: SHA },
      { object: `certificate/../${KEY}`, contentType: "application/pdf", size: BYTES.length, sha256: SHA }]) {
      db.grant = grant;
      expect((await get(await privateUrl())).status).toBe(404);
    }
  });

  it("supports single byte ranges and HEAD", async () => {
    const url = await privateUrl();
    const part = await get(url, { range: "bytes=0-3" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-3/${BYTES.length}`);
    expect(await part.text()).toBe("%PDF");
    const tail = await get(url, { range: "bytes=-5" });
    expect(await tail.text()).toBe("bytes");
    const bad = await get(url, { range: `bytes=${BYTES.length}-` });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${BYTES.length}`);
    expect((await get(url, { range: "bytes=0-1,4-5" })).status).toBe(200);
    const head = await get(url, {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(BYTES.length));
    expect(calls.private).toBe(5);
  });

  it("answers non-GET methods and CORS preflights with the generic 404", async () => {
    for (const method of ["POST", "OPTIONS", "PUT", "DELETE"]) {
      const res = await get(await privateUrl(), { origin: "https://evil.example" }, method);
      expect(res.status).toBe(404);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("fails closed when the database errors or the route family is disabled", async () => {
    const broken = createHandler({ authority: () => ({ ...fakeAuthority(), authorizePrivate: async () => { throw new Error("db down"); } }), now: () => NOW * 1000 });
    expect((await broken(new Request(await privateUrl()), env, ctx)).status).toBe(404);
    env.PRIVATE_ROUTES = "off";
    expect((await get(await privateUrl())).status).toBe(404);
  });
});

describe("Mode C: conditional public delivery", () => {
  const url = `https://media.example.test/c/portfolio/${ITEM}/original`;

  it("serves eligible media with revalidation headers and an ETag", async () => {
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toBe(`"${"a".repeat(64)}"`);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("re-authorizes every revalidation: 304 while eligible, 404 right after withdrawal", async () => {
    const etag = `"${"a".repeat(64)}"`;
    expect((await get(url, { "if-none-match": etag })).status).toBe(304);
    db.published = false;
    expect((await get(url, { "if-none-match": etag })).status).toBe(404);
    db.published = true; db.suspended = true;
    expect((await get(url)).status).toBe(404);
    expect(calls.public).toBe(3);
  });

  it("serves only portfolio/avatar by opaque id, never by key or with a query", async () => {
    for (const bad of [`https://media.example.test/c/certificate/${ITEM}/original`, `https://media.example.test/c/portfolio/e9100000-0000-4000-8000-000000000001.png/original`,
      `${url}?t=x`, `https://media.example.test/c/portfolio/${ITEM}/raw`]) {
      expect((await get(bad)).status).toBe(404);
    }
    expect(calls.public).toBe(0);
    env.PUBLIC_ROUTES = "off";
    expect((await get(url)).status).toBe(404);
  });
});

describe("parseRange", () => {
  it("handles open, suffix, clamped and invalid ranges", () => {
    expect(parseRange("bytes=2-", 10)).toEqual({ offset: 2, length: 8 });
    expect(parseRange("bytes=2-100", 10)).toEqual({ offset: 2, length: 8 });
    expect(parseRange("bytes=-100", 10)).toEqual({ offset: 0, length: 10 });
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
    expect(parseRange("items=0-1", 10)).toBeNull();
    expect(parseRange("bytes=0-1", null)).toBeNull();
  });
});

describe("edge byte cache", () => {
  /** A Map-backed stand-in for caches.default that counts reads and writes. */
  function memoryCache() {
    const store = new Map<string, { body: Uint8Array; headers: Headers }>();
    const stats = { match: 0, put: 0 };
    return {
      store, stats,
      cache: {
        async match(key: string) {
          stats.match++;
          const hit = store.get(key);
          return hit ? new Response(hit.body.slice(), { headers: hit.headers }) : undefined;
        },
        async put(key: string, response: Response) {
          stats.put++;
          store.set(key, { body: new Uint8Array(await response.arrayBuffer()), headers: response.headers });
        },
      },
    };
  }
  let mem: ReturnType<typeof memoryCache>;
  let r2Gets: number;
  let cached: ReturnType<typeof createHandler>;
  const cget = (url: string, headers: Record<string, string> = {}) => cached(new Request(url, { headers }), env, ctx);

  beforeEach(() => {
    mem = memoryCache();
    r2Gets = 0;
    const inner = env.MEDIA_BUCKET;
    env.MEDIA_BUCKET = { ...inner, get: (k, o) => { r2Gets++; return inner.get(k, o); } };
    env.EDGE_CACHE = "on";
    cached = createHandler({ authority: () => fakeAuthority(), now: () => NOW * 1000, cache: () => mem.cache });
  });

  it("fills on a miss and serves the next authorized request without reading R2", async () => {
    const first = await cget(await privateUrl());
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(BYTES);
    await Promise.all(waits);
    expect(mem.stats.put).toBe(1);
    const second = await cget(await privateUrl());
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(BYTES);
    expect(r2Gets).toBe(1);
    // The browser still gets private, no-store headers; the stored copy is internal.
    expect(second.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect([...mem.store.keys()][0]).toBe(`https://media-edge.internal/certificate/${KEY}?sha256=${SHA}`);
  });

  it("never lets a cached copy outlive revocation: the database is asked first", async () => {
    await (await cget(await privateUrl())).arrayBuffer();
    await Promise.all(waits);
    db.deleted = true;
    expect((await cget(await privateUrl())).status).toBe(404);
    db.deleted = false; db.sessionRevoked = true;
    expect((await cget(await privateUrl())).status).toBe(404);
    expect(calls.private).toBe(3);
  });

  it("re-reads R2 when the cached entry does not match the verified size", async () => {
    await (await cget(await privateUrl())).arrayBuffer();
    await Promise.all(waits);
    const [key] = [...mem.store.keys()];
    mem.store.set(key!, { body: new Uint8Array([1, 2, 3]), headers: new Headers({ "content-length": "3" }) });
    const res = await cget(await privateUrl());
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    expect(r2Gets).toBe(2);
  });

  it("bypasses the cache for ranges, when switched off, and when the cache fails", async () => {
    await (await cget(await privateUrl(), { range: "bytes=0-3" })).arrayBuffer();
    expect(mem.stats.match + mem.stats.put).toBe(0);
    env.EDGE_CACHE = "off";
    await (await cget(await privateUrl())).arrayBuffer();
    expect(mem.stats.match + mem.stats.put).toBe(0);
    env.EDGE_CACHE = "on";
    mem.cache.match = async () => { throw new Error("cache down"); };
    const res = await cget(await privateUrl());
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("caches conditional public bytes too, still re-authorizing every view", async () => {
    const url = `https://media.example.test/c/portfolio/${ITEM}/original`;
    await (await cget(url)).arrayBuffer();
    await Promise.all(waits);
    expect((await cget(url)).headers.get("cache-control")).toBe("private, no-cache");
    db.published = false;
    expect((await cget(url)).status).toBe(404);
    expect(r2Gets).toBe(1);
  });
});
