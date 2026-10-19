import "server-only";
import { getServerSupabase } from "@/lib/supabase/server";
import { readSessionIdentity } from "@/server/auth/session";
import { cacheKey, count, withRedis } from "./redis";

/**
 * Cache-aside for REFERENCE VOCABULARIES: lists that every signed-in caller
 * reads identically (trades, specialties, product categories). They are display
 * and selection data only. Choosing a stale or retired entry grants nothing,
 * because the write RPCs validate every key against the live table.
 *
 * Rules that keep this safe:
 *   * Only the names below can be cached. Adding one means confirming its RLS
 *     policy returns the same rows to every authenticated caller, and the loader
 *     filters out anything a staff policy would add (e.g. `is_active = true`).
 *   * A caller without a verified session never reads or fills the cache; their
 *     query goes to Postgres, where RLS decides.
 *   * An empty result is kept for five minutes only, so a transient RLS or seed
 *     gap is not pinned for the full TTL, while a vocabulary that is empty by
 *     design (no specialties seeded yet) does not cost a database read on
 *     every page.
 *   * Freshness: the TTL bounds staleness. No application path writes these
 *     vocabularies today (they change by migration), so after such a migration
 *     entries refresh within ten minutes; `invalidateReference` is for any
 *     future write path, which must call it.
 */
export const REFERENCE_TTL_SECONDS = 600;
export const EMPTY_REFERENCE_TTL_SECONDS = 300;
export type ReferenceName = "trades" | "trade-specialties" | "product-categories";

const inflight = new Map<string, Promise<unknown[]>>();

function referenceKey(name: ReferenceName): string {
  return cacheKey("ref", "global", name);
}

export async function cachedReference<T>(name: ReferenceName, load: () => Promise<T[]>): Promise<T[]> {
  const client = await getServerSupabase();
  if (!(await readSessionIdentity(client))) return load();
  const key = referenceKey(name);
  const cached = await withRedis("ref", (redis) => redis.get(key));
  if (typeof cached === "string") {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        count("ref", "hits");
        return parsed as T[];
      }
    } catch { /* corrupt entry: reload below */ }
  }
  count("ref", "misses");
  // One Postgres read per warm instance while an entry is missing.
  let pending = inflight.get(key) as Promise<T[]> | undefined;
  if (!pending) {
    pending = load().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const rows = await pending;
  const ttl = rows.length > 0 ? REFERENCE_TTL_SECONDS : EMPTY_REFERENCE_TTL_SECONDS;
  const stored = await withRedis("ref", (redis) =>
    redis.set(key, JSON.stringify(rows), { expiration: { type: "EX", value: ttl } }));
  if (stored !== undefined) count("ref", "sets");
  return rows;
}

export async function invalidateReference(name: ReferenceName): Promise<void> {
  const deleted = await withRedis("ref", (redis) => redis.del(referenceKey(name)));
  if (deleted !== undefined) count("ref", "invalidations");
}
