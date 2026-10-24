import { NextResponse } from "next/server";
import { cacheMetrics, lastRedisSuccessAt, redisEnabled, withRedis } from "@/server/cache/redis";

export const dynamic = "force-dynamic";

// An uptime monitor polling every minute would otherwise spend ~43,000 Redis
// commands a month on PING alone; a recent successful command proves the same.
const PING_IF_IDLE_MS = 60_000;

/** Liveness probe for the web app. See docs/operations/monitoring-and-observability.md. */
export async function GET() {
  // Redis is optional: "unavailable" means slower pages and per-instance rate
  // limits, never wrong access.
  let cache: "disabled" | "ok" | "unavailable" = "disabled";
  if (redisEnabled()) {
    const recent = Date.now() - lastRedisSuccessAt() < PING_IF_IDLE_MS && !cacheMetrics().breakerOpen;
    const healthy = recent || (await withRedis("health", (redis) => redis.ping())) === "PONG";
    cache = healthy ? "ok" : "unavailable";
  }
  return NextResponse.json({
    status: "ok",
    service: "frontend",
    cache,
    // One warm instance's counters (no keys, values or URLs). With Redis off,
    // `rl.fallback` and `rl.limited` still show the memory limiter at work.
    cacheMetrics: cacheMetrics(),
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
