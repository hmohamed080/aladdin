import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isOAuthProvider, type OAuthProvider } from "@/server/auth/entry-oauth";
import type { Database } from "@/types/database.types";

/**
 * Connecting Google or Facebook to the account you are ALREADY signed in to
 * (Settings → Privacy & security → Sign-in methods). The identity is attached
 * to this user id by Supabase Auth, which refuses an identity that already
 * belongs to a different user — so linking can never create a second account or
 * move one between accounts. Only a short whitelist of outcomes rides the URL.
 */

export const LINK_RETURN_PATH = "/home/settings#settings-security";
export type LinkNotice = "connected" | "taken" | "failed";

export function linkCallbackUrl(origin: string, provider: OAuthProvider): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("link", "1");
  url.searchParams.set("provider", provider);
  return url.toString();
}

export function linkReturnPath(notice: LinkNotice, provider: string | null): string {
  const query = new URLSearchParams({ link: notice });
  if (provider && isOAuthProvider(provider)) query.set("provider", provider);
  return `/home/settings?${query.toString()}#settings-security`;
}

/** Finishes the round trip started by `linkIdentity` in the browser. */
export async function completeIdentityLink(
  supabase: SupabaseClient<Database>,
  params: { code: string | null; provider: string | null; providerError: string | null; errorCode: string | null },
): Promise<string> {
  if (params.errorCode === "identity_already_exists") return linkReturnPath("taken", params.provider);
  if (params.providerError || !params.code) return linkReturnPath("failed", params.provider);
  const { error } = await supabase.auth.exchangeCodeForSession(params.code);
  if (error) return linkReturnPath("failed", params.provider);
  return linkReturnPath("connected", params.provider);
}
