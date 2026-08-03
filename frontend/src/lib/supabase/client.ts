import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Browser Supabase client (anon key, constrained by RLS). The session is stored
 * in cookies shared with the server (`@supabase/ssr`), so Server Components and
 * Server Actions run as the same authenticated caller. The service-role key is
 * NEVER used — it is server-only and trusted-path only (ADR-0007). See
 * docs/technical/06_rls_strategy.md.
 */
export function createBrowserSupabaseClient(): SupabaseClient<Database> {
  const env = readPublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
