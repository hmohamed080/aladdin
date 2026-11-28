import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { cacheEnvSchema } from "@/lib/env/cache";
import { cacheMetrics, closeBreakerForTests, redisTransport, resetRedisForTests, withRedis } from "./redis";
import { RestCommandError, restCommands } from "./redis-commands";
import { consumeRateLimit, RATE_LIMITS, resetMemoryLimiterForTests } from "./rate-limit";

const USER_A = "11111111-1111-4111-8111-111111111111";
const URL_ = "https://example-db.upstash.io";
const TOKEN = "AXsecret-token_value";

/**
 * A stand-in for Upstash's REST API, following its documented contract:
 * POST <base> with a JSON array ["CMD", ...args], `Authorization: Bearer`,
 * reply 200 `{ result }` or 4xx `{ error }`. Backed by a tiny in-memory store
 * that implements just the commands the app sends.
 */
function upstash(token = TOKEN) {
  const store = new Map<string, { value: string | string[]; expiresAt?: number }>();
  const requests: { url: string; auth: string | null; body: unknown[] }[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) { store.delete(key); return undefined; }
    return entry;
  };
  const run = (command: string, args: string[]): unknown => {
    switch (command) {
      case "PING": return "PONG";
      case "GET": { const v = live(args[0]!)?.value; if (Array.isArray(v)) throw new Error("WRONGTYPE"); return v ?? null; }
      case "SET": {
        const ex = args[2]?.toUpperCase() === "EX" ? Number(args[3]) : undefined;
        store.set(args[0]!, { value: args[1]!, expiresAt: ex === undefined ? undefined : Date.now() + ex * 1000 });
        return "OK";
      }
      case "DEL": return args.filter((key) => store.delete(key)).length;
      case "LPUSH": {
        const list = (live(args[0]!)?.value as string[] | undefined) ?? [];
        list.unshift(...args.slice(1));
        store.set(args[0]!, { value: list });
        return list.length;
      }
      case "EVAL": {
        // Only the limiter's INCR-then-EXPIRE script.
        const [, numkeys, key, ttl] = args;
        if (numkeys !== "1") throw new Error("ERR unexpected script");
        const entry = live(key!);
        const n = Number(entry?.value ?? 0) + 1;
        store.set(key!, { value: String(n), expiresAt: n === 1 ? Date.now() + Number(ttl) * 1000 : entry?.expiresAt });
        return n;
      }
      default: throw new Error(`ERR unknown command '${command}'`);
    }
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    const body = JSON.parse(String(init?.body)) as unknown[];
    requests.push({ url, auth, body });
    if (auth !== `Bearer ${token}`) return reply(401, { error: "Unauthorized" });
    if (url.endsWith("/pipeline")) return reply(400, { error: "pipeline not expected" });
    try {
      return reply(200, { result: run(String(body[0]).toUpperCase(), body.slice(1).map(String)) });
    } catch (error) {
      return reply(400, { error: (error as Error).message });
    }
  });
  return { fetchMock, store, requests };
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe("REST settings", () => {
  const on = { REDIS_CACHE_ENABLED: "true" };
  it("accepts the pair alone, without REDIS_URL", () => {
    const env = cacheEnvSchema.parse({ ...on, REDIS_REST_URL: URL_, REDIS_REST_TOKEN: TOKEN, APP_ENV: "production", REDIS_KEY_ENV: "production" });
    expect(env.REDIS_REST_URL).toBe(URL_);
  });
  it("needs both halves of the pair", () => {
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: URL_ })).toThrow(/REDIS_REST_TOKEN/);
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_TOKEN: TOKEN })).toThrow(/REDIS_REST_URL/);
  });
  it("requires https outside local, and allows http only locally", () => {
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: "http://example-db.upstash.io", REDIS_REST_TOKEN: TOKEN, APP_ENV: "staging" })).toThrow(/https/);
    expect(cacheEnvSchema.parse({ ...on, REDIS_REST_URL: "http://127.0.0.1:8079", REDIS_REST_TOKEN: TOKEN, APP_ENV: "local" }).REDIS_CACHE_ENABLED).toBe(true);
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: "redis://example-db.upstash.io", REDIS_REST_TOKEN: TOKEN })).toThrow(/https/);
  });
  it("refuses credentials or a query in the URL, and a token with whitespace", () => {
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: "https://u:p@example-db.upstash.io", REDIS_REST_TOKEN: TOKEN })).toThrow(/bare endpoint/);
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: `${URL_}?token=x`, REDIS_REST_TOKEN: TOKEN })).toThrow(/bare endpoint/);
    expect(() => cacheEnvSchema.parse({ ...on, REDIS_REST_URL: URL_, REDIS_REST_TOKEN: "a b" })).toThrow(/whitespace/);
  });
});

describe("REST commands (Upstash wire format)", () => {
  it("send each command as one POST of a JSON array with a bearer token, to the base URL", async () => {
    const { fetchMock, requests } = upstash();
    const redis = restCommands({ url: `${URL_}/`, token: TOKEN, timeoutMs: 500, fetch: fetchMock });
    expect(await redis.setEx("k", "v", 600)).toBe("OK");
    expect(await redis.get("k")).toBe("v");
    expect(await redis.get("missing")).toBeNull();
    expect(await redis.lPush("q", "id-1")).toBe(1);
    expect(await redis.del("k")).toBe(1);
    expect(await redis.ping()).toBe("PONG");
    expect(await redis.eval("script", ["rl"], ["60"])).toBe(1);
    expect(requests.map((r) => r.body)).toEqual([
      ["SET", "k", "v", "EX", 600],
      ["GET", "k"],
      ["GET", "missing"],
      ["LPUSH", "q", "id-1"],
      ["DEL", "k"],
      ["PING"],
      ["EVAL", "script", 1, "rl", "60"],
    ]);
    expect(requests.every((r) => r.url === URL_ && r.auth === `Bearer ${TOKEN}`)).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("turn {error}, HTTP failures, bad bodies, timeouts and network errors into coded errors without the token", async () => {
    const cases: [string, typeof fetch][] = [
      ["rest:error", async () => new Response(JSON.stringify({ error: "WRONGTYPE" }), { status: 200 })],
      ["rest:401", async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })],
      ["rest:500", async () => new Response("oops", { status: 500 })],
      ["rest:malformed", async () => new Response("not json", { status: 200 })],
      ["rest:malformed", async () => new Response(JSON.stringify({ nothing: 1 }), { status: 200 })],
      ["rest:network", async () => { throw new TypeError("fetch failed"); }],
    ];
    for (const [code, fetchImpl] of cases) {
      const error = await restCommands({ url: URL_, token: TOKEN, timeoutMs: 500, fetch: fetchImpl }).get("k").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RestCommandError);
      expect((error as RestCommandError).code).toBe(code);
      expect(String((error as Error).message)).not.toContain(TOKEN);
    }
    // A wrong type where the app expects an integer is refused, not passed on.
    const wrong = restCommands({ url: URL_, token: TOKEN, timeoutMs: 500, fetch: async () => new Response(JSON.stringify({ result: "1" })) });
    await expect(wrong.lPush("q", "x")).rejects.toMatchObject({ code: "rest:malformed" });
  });

  it("bound every call with AbortSignal.timeout", async () => {
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
    const started = Date.now();
    await expect(restCommands({ url: URL_, token: TOKEN, timeoutMs: 50, fetch: hang }).ping()).rejects.toMatchObject({ code: "rest:timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("withRedis over REST", () => {
  let mock: ReturnType<typeof upstash>;
  beforeEach(() => {
    mock = upstash();
    vi.stubGlobal("fetch", mock.fetchMock);
    setEnv({ REDIS_CACHE_ENABLED: "true", REDIS_URL: undefined, REDIS_REST_URL: URL_, REDIS_REST_TOKEN: TOKEN, NEXT_PUBLIC_APP_ENV: "production", REDIS_KEY_ENV: "test" });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    setEnv({ REDIS_REST_URL: undefined, REDIS_REST_TOKEN: undefined, REDIS_URL: undefined, REDIS_CACHE_ENABLED: undefined, NEXT_PUBLIC_APP_ENV: undefined, REDIS_KEY_ENV: undefined });
    await resetRedisForTests();
    resetMemoryLimiterForTests();
  });

  it("is chosen over TCP when both are configured", async () => {
    setEnv({ REDIS_URL: "rediss://default:pw@example-db.upstash.io:6379" });
    expect(redisTransport()).toBe("rest");
    expect(await withRedis("t", (redis) => redis.ping())).toBe("PONG");
    expect(mock.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts one command per command and no handshake or connection", async () => {
    await withRedis("t", (redis) => redis.get("a"));
    await withRedis("t", (redis) => redis.get("b"));
    expect(cacheMetrics().usage).toMatchObject({ commands: 2, connects: 0 });
    expect(cacheMetrics().transport).toBe("rest");
  });

  it("rate-limits through Redis with the same key scheme and TTL", async () => {
    const { limit, windowSeconds } = RATE_LIMITS["media-upload"];
    for (let i = 0; i < limit; i += 1) expect(await consumeRateLimit("media-upload", USER_A)).toMatchObject({ outcome: "allowed", source: "redis" });
    expect(await consumeRateLimit("media-upload", USER_A)).toMatchObject({ outcome: "limited", source: "redis" });
    const keys = [...mock.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^aladdin:test:v1:rl:u-${USER_A}:[0-9a-f]{32}$`));
    const ttlMs = (mock.store.get(keys[0]!)?.expiresAt ?? 0) - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(windowSeconds * 1000);
    // Refused locally from now on: no more requests.
    const sent = mock.fetchMock.mock.calls.length;
    expect((await consumeRateLimit("media-upload", USER_A)).source).toBe("memory");
    expect(mock.fetchMock.mock.calls.length).toBe(sent);
  });

  it("fails safe: a bad token opens the breaker at once, logs one line without secrets, limits fall back to memory", async () => {
    vi.stubGlobal("fetch", upstash("another-token").fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await consumeRateLimit("media-upload", USER_A)).toMatchObject({ outcome: "allowed", source: "memory" });
    expect(cacheMetrics().breakerOpen).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "cache.redis_unavailable", error: "rest:401" });
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain("upstash.io");
    warn.mockRestore();
  });

  it("opens the breaker on the second timeout in a row, not the first", async () => {
    vi.stubGlobal("fetch", (() => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))) as typeof fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await withRedis("t", (redis) => redis.ping())).toBeUndefined();
    expect(cacheMetrics().breakerOpen).toBe(false);
    expect(await withRedis("t", (redis) => redis.ping())).toBeUndefined();
    expect(cacheMetrics().breakerOpen).toBe(true);
    expect(String(warn.mock.calls[0]?.[0])).toContain("rest:timeout");
    closeBreakerForTests();
    vi.stubGlobal("fetch", mock.fetchMock);
    expect(await withRedis("t", (redis) => redis.ping())).toBe("PONG");
    expect(cacheMetrics().namespaces.t).toMatchObject({ errors: 2 });
    warn.mockRestore();
  });
});

describe("on Cloudflare Workers", () => {
  beforeEach(() => vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" }));
  afterEach(async () => {
    vi.unstubAllGlobals();
    setEnv({ REDIS_REST_URL: undefined, REDIS_REST_TOKEN: undefined, REDIS_URL: undefined, REDIS_CACHE_ENABLED: undefined, NEXT_PUBLIC_APP_ENV: undefined });
    await resetRedisForTests();
    resetMemoryLimiterForTests();
  });

  it("refuses TCP (no cross-request socket), says so once, and falls back", async () => {
    setEnv({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:6390", NEXT_PUBLIC_APP_ENV: "local" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const command = vi.fn(async () => "PONG");
    expect(redisTransport()).toBe("none");
    expect(await withRedis("t", command)).toBeUndefined();
    expect(await consumeRateLimit("media-read", USER_A)).toMatchObject({ outcome: "allowed", source: "memory" });
    expect(command).not.toHaveBeenCalled();
    expect(cacheMetrics().usage.connects).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("cache.redis_tcp_unsupported");
    warn.mockRestore();
  });

  it("uses REST when it is configured", async () => {
    const mock = upstash();
    vi.stubGlobal("fetch", mock.fetchMock);
    setEnv({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:6390", REDIS_REST_URL: URL_, REDIS_REST_TOKEN: TOKEN, NEXT_PUBLIC_APP_ENV: "local" });
    expect(await withRedis("t", (redis) => redis.ping())).toBe("PONG");
    expect(cacheMetrics().transport).toBe("rest");
  });
});
