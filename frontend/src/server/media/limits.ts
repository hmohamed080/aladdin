import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { readStorageEnv } from "@/lib/env/storage";
import {
  MEDIA_LIMIT_CEILING, parseLimitRows, resolveLimit, type MediaKind, type MediaLimitRow,
} from "@/lib/media/limits";
import type { MediaNamespace } from "@/lib/storage/provider-types";
import { videoLimitPlace, type VideoScope } from "@/lib/media/video-policy";

/**
 * The stored upload limits, read on the server (service role, read-only RPC `media_limits_get`) and
 * cached for a short time per instance. The database enforces the same value on the verification
 * receipt and on new video rows, so a stale cache can only make THIS check more or less strict for a
 * few seconds; it can never let an upload through the database refuses.
 *
 * When the stored value cannot be read, the compiled defaults apply (the previous caps).
 */
const TTL_MS = 30_000;
let cache: { at: number; rows: MediaLimitRow[] } | null = null;

export function invalidateMediaLimitCache() {
  cache = null;
}

export async function loadMediaLimits(now = Date.now()): Promise<MediaLimitRow[] | null> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  try {
    const env = readStorageEnv();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return cache?.rows ?? null;
    const client = createClient(readPublicEnv().NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("media_limits_get");
    if (error) return cache?.rows ?? null;
    const rows = parseLimitRows(data);
    if (rows.length === 0) return cache?.rows ?? null;
    cache = { at: now, rows };
    return rows;
  } catch {
    return cache?.rows ?? null;
  }
}

/** The image limit in force for a namespace (a "place"). */
export async function imageMaxBytes(namespace: MediaNamespace): Promise<number> {
  return resolveLimit(await loadMediaLimits(), "image", namespace);
}

/** The video limit in force for a scope. */
export async function videoMaxBytes(scope: VideoScope): Promise<number> {
  return resolveLimit(await loadMediaLimits(), "video", videoLimitPlace(scope));
}

/**
 * The largest object the platform will ever serve or read back for a kind. Reading and serving a file that is
 * already stored must not depend on today's upload limit: an administrator who lowers a limit must not break
 * the files uploaded under the previous one.
 */
export function storedObjectCeiling(kind: MediaKind): number {
  return MEDIA_LIMIT_CEILING[kind];
}
