import "server-only";
import { cacheKey, count, withRedis } from "./redis";

/**
 * Per-user request ceilings on expensive, abusable paths (fixed window: INCR,
 * and EXPIRE on the first hit, atomically in one script so a crash can't leave
 * a key without a TTL; plain Redis 6+, Valkey and Upstash all run it).
 *
 * FAIL SAFE, NOT OPEN. When Redis is off, unreachable or slow, the same window
 * is counted in this instance's memory instead, so a limit always applies.
 * Why memory and not Postgres: the fallback must work exactly when something is
 * already wrong, add no load to the Supabase database it protects (one write
 * per image read would), and cost nothing. Its weakness is that each serverless
 * instance counts separately, so a user spread across N warm instances gets at
 * most N times the limit; the authoritative ceilings (media reservation quotas,
 * phone sign-in throttles) stay in Postgres regardless.
 *
 * COMMAND BUDGET. Each check is one Redis command (EVAL), refused requests
 * included. So once Redis has refused a user, this instance remembers it until
 * the window ends and refuses locally: a client hammering a limited path spends
 * no further commands from the monthly allowance.
 *
 * A limiter never grants anything: "allowed" only means "not refused here".
 * Redis keys are per user (`u-{uuid}` scope), so one user's traffic never
 * spends another user's allowance.
 */
export const RATE_LIMITS = {
  // Signed upload URLs. Each one reserves a row and may sign an R2 PUT.
  "media-upload": { limit: 60, windowSeconds: 600 },
  // Private media reads through the application proxy (one per image shown).
  "media-read": { limit: 1_200, windowSeconds: 60 },
  // Video: signed multipart part URLs (a 2 GB upload at 16 MB parts is 128).
  "video-part": { limit: 600, windowSeconds: 600 },
} as const;

const WINDOW_SCRIPT = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";

export type RateLimitRule = keyof typeof RATE_LIMITS;
export type RateLimitResult = { outcome: "allowed" | "limited"; source: "redis" | "memory"; retryAfterSeconds?: number };

// Bounded so a flood of distinct users cannot grow the fallback without limit.
const MEMORY_MAX_KEYS = 20_000;
const memory = new Map<string, { window: number; used: number; expiresAt: number }>();
// Users Redis has already refused in the current window: refused locally until it ends.
const blocked = new Map<string, number>();

function consumeInMemory(key: string, window: number, windowSeconds: number): number {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.window !== window) {
    if (memory.size >= MEMORY_MAX_KEYS) {
      for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
      // Still full of live windows: drop the oldest insertions.
      for (const k of memory.keys()) {
        if (memory.size < MEMORY_MAX_KEYS) break;
        memory.delete(k);
      }
    }
    entry = { window, used: 0, expiresAt: (window + 1) * windowSeconds * 1000 };
    memory.delete(key);
    memory.set(key, entry);
  }
  entry.used += 1;
  return entry.used;
}

/** Test seam. */
export function resetMemoryLimiterForTests() {
  memory.clear();
  blocked.clear();
}

function rememberBlocked(key: string, untilMs: number) {
  if (blocked.size >= MEMORY_MAX_KEYS) {
    const now = Date.now();
    for (const [k, until] of blocked) if (until <= now) blocked.delete(k);
    for (const k of blocked.keys()) {
      if (blocked.size < MEMORY_MAX_KEYS) break;
      blocked.delete(k);
    }
  }
  blocked.set(key, untilMs);
}

export async function consumeRateLimit(rule: RateLimitRule, userId: string): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[rule];
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const retryAfterSeconds = (window + 1) * windowSeconds - Math.floor(Date.now() / 1000);
  const localKey = `${rule}:${userId}`;
  const blockedUntil = blocked.get(localKey);
  if (blockedUntil !== undefined && blockedUntil > Date.now()) {
    count("rl", "limited");
    return { outcome: "limited", source: "memory", retryAfterSeconds };
  }
  const key = cacheKey("rl", { user: userId }, rule, String(window));
  const reply = await withRedis("rl", (redis) =>
    redis.eval(WINDOW_SCRIPT, { keys: [key], arguments: [String(windowSeconds)] }));
  let used = typeof reply === "number" ? reply : Number.NaN;
  let source: RateLimitResult["source"] = "redis";
  if (!Number.isFinite(used)) {
    used = consumeInMemory(localKey, window, windowSeconds);
    source = "memory";
    count("rl", "fallback");
  }
  if (used > limit) {
    count("rl", "limited");
    if (source === "redis") rememberBlocked(localKey, (window + 1) * windowSeconds * 1000);
    return { outcome: "limited", source, retryAfterSeconds };
  }
  return { outcome: "allowed", source };
}
