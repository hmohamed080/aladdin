import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Browser Supabase client (anon key, constrained by RLS).
 *
 * Server-side access with the caller's session (Server Actions / Route Handlers)
 * is provided by {@link createServerSupabaseClient} in `./server`. The
 * service-role key is NEVER used in either — it is server-only and trusted-path
 * only. See docs/security/rls-strategy.md and ADR-0007.
 */
export function createBrowserSupabaseClient(): SupabaseClient<Database> {
  const env = readPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
