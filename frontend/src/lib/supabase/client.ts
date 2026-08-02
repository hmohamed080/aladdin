import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";

/**
 * Browser Supabase client (anon key, constrained by RLS).
 *
 * Server-side access (Server Actions / Route Handlers) and auth session
 * handling are added by the `auth` feature; the service-role key is NEVER
 * used here — it is server-only. See docs/security/rls-strategy.md.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const env = readPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
