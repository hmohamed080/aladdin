import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Cookie-backed, CALLER-scoped server Supabase client (Server Components, Server
 * Actions, Route Handlers). The session lives in HTTP-only cookies managed by
 * `@supabase/ssr`, so every query runs under the caller's `authenticated`
 * identity and Postgres RLS enforces tenant/branch isolation — never application
 * filtering (ADR-0007/0008). The service-role key is NEVER used here.
 *
 * `setAll` is a no-op when called during a Server Component render (cookies are
 * read-only there); the middleware refreshes the session cookie on navigation.
 */
export async function getServerSupabase(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const env = readPublicEnv();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render — the middleware owns refresh.
          }
        },
      },
    },
  );
}

/**
 * Explicit-token variant for trusted server/worker paths that already hold a
 * verified caller access token (kept for the data-access boundary; ADR-0007).
 * Still the caller's identity — never service-role.
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
