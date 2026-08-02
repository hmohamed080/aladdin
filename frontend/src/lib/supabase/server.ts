import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Server-side Supabase client scoped to the CALLER, preserving their access
 * token so Postgres RLS applies (ADR-0007). Use this in Server Actions / Route
 * Handlers for any user-scoped read/write: every query runs under the caller's
 * `authenticated` identity, so tenant isolation is enforced by the database, not
 * by application filtering.
 *
 * It authenticates with the public anon key and forwards the caller's token as
 * the Authorization header. The service-role key is NEVER used here — it bypasses
 * RLS and belongs only to trusted server/worker paths, never to request handlers
 * serving a user. Session/cookie plumbing (obtaining `accessToken`) is owned by
 * the `auth` feature; this factory only turns a verified token into a scoped
 * client.
 */
export function createServerSupabaseClient(
  accessToken: string,
): SupabaseClient<Database> {
  if (!accessToken) {
    throw new Error("A caller access token is required for a server-scoped client.");
  }
  const env = readPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
