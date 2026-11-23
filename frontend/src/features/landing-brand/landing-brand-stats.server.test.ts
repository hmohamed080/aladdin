import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const store = new Map<string, string>();
let redisOn = true;
const redis = { get: vi.fn(async (k: string) => store.get(k) ?? null), setEx: vi.fn(async (k: string, v: string) => { store.set(k, v); return "OK"; }) };
const scheduled: Array<() => Promise<void>> = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { scheduled.push(fn); } }));
// The validated public settings (a missing value means "local"); the test sets the environment per case.
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV ?? "local" }) }));
vi.mock("@/lib/supabase/admin-server", () => ({ countLandingPublicStats: () => count() }));
vi.mock("@/server/cache/redis", () => ({
  cacheKey: (...p: unknown[]) => `k:${p.join(":")}`,
  count: () => undefined,
  withRedis: async (_ns: string, fn: (r: typeof redis) => Promise<unknown>) => (redisOn ? fn(redis) : undefined),
}));

const GOOD = { users: 10, organizations: 2, products: 5 };

async function drain() {
  while (scheduled.length) await scheduled.shift()!();
}

// The data-centre cache (Cloudflare `caches.default`), faked with a Map keyed by URL.
const coloStore = new Map<string, string>();
const fakeCaches = {
  default: {
    match: vi.fn(async (req: Request) => (coloStore.has(req.url) ? new Response(coloStore.get(req.url)!) : undefined)),
    put: vi.fn(async (req: Request, res: Response) => { coloStore.set(req.url, await res.text()); }),
  },
};
const withColo = () => vi.stubGlobal("caches", fakeCaches);
const MIN = 60 * 1000;

async function fresh() {
  vi.resetModules();
  return (await import("./landing-brand-stats.server")).readLandingStats;
}

describe("readLandingStats", () => {
  beforeEach(() => {
    count.mockReset();
    store.clear();
    scheduled.length = 0;
    redisOn = true;
    redis.get.mockClear();
    redis.setEx.mockClear();
    coloStore.clear();
    fakeCaches.default.match.mockClear();
    fakeCaches.default.put.mockClear();
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
  });

  it("shares one database read between concurrent requests and caches it", async () => {
    count.mockResolvedValue(GOOD);
    const read = await fresh();
    const [a, b] = await Promise.all([read(1_000), read(1_000)]);
    expect(a).toEqual(b);
    await read(2_000);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed read for a minute, then tries again", async () => {
    count.mockRejectedValue(new Error("down"));
    const read = await fresh();
    expect(await read(0)).toEqual({ users: null, organizations: null, products: null });
    await read(30_000);
    expect(count).toHaveBeenCalledTimes(1);
    await read(61_000);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good value when a later read fails", async () => {
    count.mockResolvedValueOnce(GOOD);
    const read = await fresh();
    await read(0);
    count.mockRejectedValue(new Error("down"));
    expect(await read(11 * MIN)).toEqual(GOOD);
  });

  it("writes the value to Redis after a database read", async () => {
    count.mockResolvedValue(GOOD);
    const read = await fresh();
    await read(5_000);
    await drain();
    expect(redis.setEx).toHaveBeenCalledTimes(1);
    expect(JSON.parse([...store.values()][0] as string)).toEqual({ ...GOOD, at: 5_000 });
  });

  it("serves a fresh shared copy without touching the database (a cold isolate)", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 1_000 }));
    const read = await fresh();
    expect(await read(1_000 + 5 * MIN)).toEqual(GOOD);
    expect(count).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it("looks at Redis at most once a minute per isolate", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 0 }));
    const read = await fresh();
    await read(1 * MIN);
    await read(1 * MIN + 30_000);
    expect(redis.get).toHaveBeenCalledTimes(1);
    await read(2 * MIN + 1);
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it("serves a stale shared copy at once and refreshes after the response", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 0 }));
    count.mockResolvedValue({ users: 11, organizations: 3, products: 6 });
    const read = await fresh();
    expect(await read(30 * MIN)).toEqual(GOOD);
    expect(count).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(count).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get("k:landing:global:stats") as string).users).toBe(11);
  });

  it("starts only one refresh at a time", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 0 }));
    count.mockResolvedValue(GOOD);
    const read = await fresh();
    await read(30 * MIN);
    await read(32 * MIN);
    expect(scheduled).toHaveLength(1);
  });

  it("keeps showing the stale shared copy when the refresh fails", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 0 }));
    count.mockRejectedValue(new Error("down"));
    const read = await fresh();
    await read(30 * MIN);
    await scheduled[0]!();
    expect(await read(30 * MIN + 10_000)).toEqual(GOOD);
  });

  it("reads the database when the shared copy is older than an hour or corrupt", async () => {
    store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 0 }));
    count.mockResolvedValue({ users: 20, organizations: 4, products: 9 });
    const read = await fresh();
    expect((await read(61 * MIN)).users).toBe(20);
    store.set("k:landing:global:stats", "{not json");
    const read2 = await fresh();
    expect((await read2(0)).users).toBe(20);
  });

  it("falls back to the database when Redis is off", async () => {
    redisOn = false;
    count.mockResolvedValue(GOOD);
    const read = await fresh();
    expect(await read(0)).toEqual(GOOD);
    expect(count).toHaveBeenCalledTimes(1);
  });

  describe("data-centre cache layer", () => {
    it("serves a fresh copy from the data-centre cache without asking Redis or the database", async () => {
      withColo();
      coloStore.set("https://landing-stats.cache.invalid/v1/production", JSON.stringify({ ...GOOD, at: 1_000 }));
      const read = await fresh();
      expect(await read(1_000 + 5 * MIN)).toEqual(GOOD);
      expect(redis.get).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    });

    it("keeps serving when Redis is off or its quota is spent", async () => {
      withColo();
      redisOn = false;
      coloStore.set("https://landing-stats.cache.invalid/v1/production", JSON.stringify({ ...GOOD, at: 0 }));
      const read = await fresh();
      expect(await read(30 * MIN)).toEqual(GOOD);
      expect(scheduled).toHaveLength(1);
    });

    it("writes both shared layers after a database read, and a new isolate then reads it without the database", async () => {
      withColo();
      count.mockResolvedValue(GOOD);
      const read = await fresh();
      await read(2_000);
      await drain();
      expect(coloStore.size).toBe(1);
      expect(redis.setEx).toHaveBeenCalledTimes(1);
      count.mockClear();
      const read2 = await fresh();
      expect(await read2(2_000 + MIN)).toEqual(GOOD);
      expect(count).not.toHaveBeenCalled();
    });

    it("asks Redis when the data-centre cache has no current copy, then warms the data-centre cache", async () => {
      withColo();
      store.set("k:landing:global:stats", JSON.stringify({ ...GOOD, at: 1_000 }));
      const read = await fresh();
      expect(await read(1_000 + MIN)).toEqual(GOOD);
      await drain();
      expect(coloStore.size).toBe(1);
      expect(count).not.toHaveBeenCalled();
    });

    it("keys the entry by environment so a preview never reads Production's copy", async () => {
      withColo();
      vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
      coloStore.set("https://landing-stats.cache.invalid/v1/production", JSON.stringify({ ...GOOD, at: 1_000 }));
      count.mockResolvedValue({ users: 1, organizations: 1, products: 1 });
      const read = await fresh();
      expect((await read(1_000 + MIN)).users).toBe(1);
    });

    it("ignores a corrupt or negative entry and falls back to the next layer", async () => {
      withColo();
      coloStore.set("https://landing-stats.cache.invalid/v1/production", JSON.stringify({ users: -1, organizations: 2, products: 3, at: 0 }));
      count.mockResolvedValue(GOOD);
      const read = await fresh();
      expect(await read(0)).toEqual(GOOD);
      expect(count).toHaveBeenCalledTimes(1);
    });

    it("survives a cache that throws", async () => {
      withColo();
      fakeCaches.default.match.mockRejectedValueOnce(new Error("boom"));
      count.mockResolvedValue(GOOD);
      const read = await fresh();
      expect(await read(0)).toEqual(GOOD);
    });
  });
});
