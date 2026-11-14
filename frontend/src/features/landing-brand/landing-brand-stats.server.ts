import "server-only";

import { countLandingPublicStats } from "@/lib/supabase/admin-server";
import type { LandingStats } from "./landing-brand-stats";

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; value: LandingStats } | null = null;

/** Real platform counts for the hero pills. Cached per isolate for 10 minutes; a failed read yields `null`s (pill hidden), never a made-up number. */
export async function readLandingStats(now = Date.now()): Promise<LandingStats> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let value: LandingStats = { users: null, organizations: null, products: null };
  try {
    value = await countLandingPublicStats();
  } catch {
    // Keep serving the last good value if there is one; otherwise render no stat.
    if (cache) return cache.value;
  }
  cache = { at: now, value };
  return value;
}

