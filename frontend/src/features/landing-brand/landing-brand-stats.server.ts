import "server-only";

import { after } from "next/server";
import { readPublicEnv } from "@/lib/env";
import { countLandingPublicStats } from "@/lib/supabase/admin-server";
import { cacheKey, count as countCache, withRedis } from "@/server/cache/redis";
import type { LandingStats } from "./landing-brand-stats";

/** How long this isolate trusts its own copy before it looks further (bounds the Upstash command budget, ADR-0019). */
const MEMORY_TTL_MS = 60 * 1000;
/** A shared copy younger than this is current. */
const FRESH_MS = 10 * 60 * 1000;
/** A shared copy older than FRESH_MS but younger than this is served at once and refreshed after the response. */
const STALE_MS = 60 * 60 * 1000;
/** Redis and the data-centre cache drop the entry after STALE_MS, so a copy older than that can never be served. */
const SHARED_TTL_SECONDS = STALE_MS / 1000;
/** After a failed read, wait this long before asking the database again, so an outage never adds a timeout to every page view. */
const RETRY_MS = 60 * 1000;
const EMPTY: LandingStats = { users: null, organizations: null, products: null };

type Shared = LandingStats & { at: number };

let memory: { at: number; ttl: number; value: LandingStats } | null = null;
let lastGood: LandingStats | null = null;
let inFlight: Promise<LandingStats> | null = null;
let refreshing = false;

/**
 * Real platform counts for the hero pills. Never a made-up number outside local development.
 *
 * Four layers, so a visitor almost never waits for the database (a cold Worker isolate used to run three `count(exact)`
 * queries on the request path):
 *   1. this isolate's memory (one minute);
 *   2. the Cloudflare data-centre cache (`caches.default`): shared by every isolate in that data centre, free, needs
 *      no Redis command and keeps working when the Redis quota is spent or Redis is off (a no-op on Node and on
 *      workers.dev, where the next layers apply);
 *   3. Redis, shared by every data centre (ADR-0019: these are global, identical-for-everyone aggregates, so they are
 *      allowed; they are not authorization or tenant data). Only asked when layer 2 has no current copy;
 *   4. the database, only when the layers above have nothing usable. Concurrent requests in one isolate share one read.
 * A shared copy is fresh for ten minutes, then served stale for up to an hour while ONE refresh runs after the response.
 * A failed database read yields the last good value (or hides the pills) and is not retried for a minute.
 */
export async function readLandingStats(now = Date.now()): Promise<LandingStats> {
  if (memory && now - memory.at < memory.ttl) return memory.value;
  inFlight ??= resolve(now).finally(() => { inFlight = null; });
  return inFlight;
}

async function resolve(now: number): Promise<LandingStats> {
  const shared = await readShared(now);
  if (shared) {
    // A failed refresh must fall back to this value, not to hidden pills.
    lastGood = { users: shared.users, organizations: shared.organizations, products: shared.products };
    const age = now - shared.at;
    if (age < FRESH_MS) return remember(now, MEMORY_TTL_MS, shared);
    if (age < STALE_MS) {
      scheduleRefresh();
      return remember(now, MEMORY_TTL_MS, shared);
    }
  }
  return load(now, false);
}

/** The newest usable shared copy: the data-centre cache first, Redis only when that has no current one. */
async function readShared(now: number): Promise<Shared | null> {
  const local = await readColo();
  if (local && now - local.at < FRESH_MS) return local;
  const remote = await readRedis();
  const best = remote && (!local || remote.at > local.at) ? remote : local;
  // Warm this data centre from Redis so its other isolates stop asking.
  if (best && best === remote && colo()) defer(() => writeColo(best));
  return best;
}

function valid(raw: unknown): Shared | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Shared>;
    const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (ok(parsed.users) && ok(parsed.organizations) && ok(parsed.products) && ok(parsed.at)) {
      return { users: parsed.users, organizations: parsed.organizations, products: parsed.products, at: parsed.at };
    }
  } catch { /* corrupt entry: ignored */ }
  return null;
}

async function readRedis(): Promise<Shared | null> {
  const parsed = valid(await withRedis("landing", (redis) => redis.get(cacheKey("landing", "global", "stats"))));
  countCache("landing", parsed ? "hits" : "misses");
  return parsed;
}

/**
 * The key is an internal URL that is never fetched: it names this entry and the environment, so a preview and
 * Production in the same data centre can never read each other's copy. No request data goes into it.
 */
function coloKey(): Request {
  const environment = encodeURIComponent(readPublicEnv().NEXT_PUBLIC_APP_ENV);
  return new Request(`https://landing-stats.cache.invalid/v1/${environment}`, { method: "GET" });
}

function colo(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

async function readColo(): Promise<Shared | null> {
  const cache = colo();
  if (!cache) return null;
  try {
    const hit = await cache.match(coloKey());
    const parsed = hit ? valid(await hit.text()) : null;
    countCache("landing-edge", parsed ? "hits" : "misses");
    return parsed;
  } catch {
    return null;
  }
}

async function writeColo(entry: Shared): Promise<void> {
  const cache = colo();
  if (!cache) return;
  try {
    await cache.put(coloKey(), new Response(JSON.stringify(entry), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${SHARED_TTL_SECONDS}` },
    }));
    countCache("landing-edge", "sets");
  } catch { /* a cache that refuses is just a miss next time */ }
}

function remember(now: number, ttl: number, value: LandingStats): LandingStats {
  memory = { at: now, ttl, value: { users: value.users, organizations: value.organizations, products: value.products } };
  return memory.value;
}

async function load(now: number, background: boolean): Promise<LandingStats> {
  try {
    const value = await countLandingPublicStats();
    // Local development has no production database, so show the mockup's figures there to review the layout.
    // Staging and production never do: they show real counts or nothing.
    if (process.env.NEXT_PUBLIC_APP_ENV === "local" && !value.users && !value.organizations && !value.products) {
      return { users: 250_000, organizations: 4_800, products: 120_000 };
    }
    lastGood = value;
    // A refresh already runs after the response; a visitor's read must not wait for the writes, so they run after it.
    if (background) await store(value, now);
    else defer(() => store(value, now));
    return remember(now, MEMORY_TTL_MS, value);
  } catch {
    if (process.env.NEXT_PUBLIC_APP_ENV === "local") return { users: 250_000, organizations: 4_800, products: 120_000 };
    return remember(now, RETRY_MS, lastGood ?? EMPTY);
  }
}

async function store(value: LandingStats, at: number): Promise<void> {
  const entry: Shared = { users: value.users ?? 0, organizations: value.organizations ?? 0, products: value.products ?? 0, at };
  await Promise.all([
    writeColo(entry),
    withRedis("landing", (redis) => redis.setEx(cacheKey("landing", "global", "stats"), JSON.stringify(entry), SHARED_TTL_SECONDS))
      .then((saved) => { if (saved !== undefined) countCache("landing", "sets"); }),
  ]);
}

/** Runs `work` after the response is sent. Outside a request there is no "after": it runs detached (and never throws). */
function defer(work: () => Promise<void>): void {
  const run = () => work().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

/** One refresh per isolate at a time, run after the response is sent (never on the visitor's path). */
function scheduleRefresh(): void {
  if (refreshing) return;
  refreshing = true;
  defer(async () => {
    try {
      await load(Date.now(), true);
    } finally {
      refreshing = false;
    }
  });
}
