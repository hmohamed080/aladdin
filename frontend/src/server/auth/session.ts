import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { identityFromClaims, type SessionIdentity } from "@/server/auth/request-gate";

export type { SessionIdentity } from "@/server/auth/request-gate";

/**
 * Per-request session reads. Every server read of "who is calling" goes through
 * one of these two:
 *
 * 1. `getSessionIdentity()` / `readSessionIdentity(client)` — the caller from the
 *    session's access token, VERIFIED LOCALLY by `auth.getClaims()` against the
 *    project's published signing keys (asymmetric ES256; supabase-js caches the key
 *    set in-process for 10 minutes). No Auth request is made unless the token must
 *    be refreshed, or the project signs with a symmetric key (supabase-js then
 *    falls back to a network `getUser()` by itself). Use it for read-only identity
 *    ("load MY rows"). It is safe there because every query runs under the same
 *    JWT and PostgREST / RLS (`auth.uid()`) and the DB suspension helpers verify
 *    that JWT on every request without asking the Auth server either — so a
 *    revoked session's token was already accepted by the database until `exp`
 *    before this helper existed.
 *
 * 2. `getCurrentUser()` — a network-validated `auth.getUser()`: the Auth server
 *    confirms the session still exists, so a session revoked by sign-out
 *    everywhere, a ban or a deletion is refused at once. Use it for admin
 *    surfaces, account-security pages (email, phone, password, sessions) and
 *    anything that needs the current full `User` record.
 *
 * Both are `cache()`d: React scopes them to ONE server render, so a layout, its
 * page and every loader share one read instead of each paying for it. Nothing
 * outlives the response and nothing is shared between callers (the key is the
 * request-scoped client). Privileged mutations (Server Actions) keep calling
 * `supabase.auth.getUser()` themselves, so they are always network-validated.
 */

/** Locally verified identity for the given request-scoped client, once per render. */
export const readSessionIdentity = cache(async function readSessionIdentity(
  // Any typed client: only `.auth` is used, which does not depend on the schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<SessionIdentity | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    return identityFromClaims(data.claims);
  } catch {
    // Fail closed, exactly like a failed getUser(): no identity.
    return null;
  }
});

/** The caller's locally verified identity, or null when signed out. */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  return readSessionIdentity(await getServerSupabase());
}

/**
 * The verified caller (network-validated by the Auth server), or null when signed
 * out. Never trusts client input. Deduplicated per render.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Require a signed-in caller; redirect to sign-in (preserving destination) otherwise. */
export async function requireUser(nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}
