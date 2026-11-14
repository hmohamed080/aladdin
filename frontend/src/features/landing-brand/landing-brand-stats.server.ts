import "server-only";

import { countLandingPublicStats } from "@/lib/supabase/admin-server";
import type { LandingStats } from "./landing-brand-stats";

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; value: LandingStats } | null = null;

/** Real platform counts for the hero pills. Cached per isolate for 10 minutes; a failed read yields `null`s (pill hidden), never a made-up number outside local development. */
export async function readLandingStats(now = Date.now()): Promise<LandingStats> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let value: LandingStats = { users: null, organizations: null, products: null };
  try {
    value = await countLandingPublicStats();
  } catch {
    // Keep serving the last good value if there is one; otherwise render no stat.
    if (cache) return cache.value;
  }
  // Local development has no production database, so show the mockup's figures there to review the layout.
  // Staging and production never do: they show real counts or nothing.
  if (process.env.NEXT_PUBLIC_APP_ENV === "local" && !value.users && !value.organizations && !value.products) {
    return { users: 250_000, organizations: 4_800, products: 120_000 };
  }
  cache = { at: now, value };
  return value;
}

