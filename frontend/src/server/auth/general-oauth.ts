import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { displayNameSchema } from "@/features/auth-password-preview/password-policy";
import { CONSENT_TYPES, ENTRY_CALLBACK_PATH } from "@/server/auth/entry-oauth";
import { sanitizeNext } from "@/server/auth/next";
import { entryLandingPath } from "@/server/auth/phone-password";

/**
 * Google / Facebook on the GENERAL pages (`/auth/sign-in`, `/auth/sign-up`).
 * Unlike the Showroom/Installer entry pages, the button does not choose an
 * account type: a person who is already registered signs in, and a first-time
 * person is sent into the normal registration steps (account type, username)
 * and reaches the app only when those are done. Supabase Auth only creates the
 * login identity; `my_registration_state()` stays the gate.
 */

type Client = SupabaseClient<Database>;

export const GENERAL_OAUTH_MARKER = "general";
export const FINISH_REGISTRATION_PATH = "/auth/finish-registration";

/** The callback handed to Supabase. Only the marker and a sanitized `next` ride it. */
export function generalCallbackUrl(origin: string, next: unknown): string {
  const url = new URL(ENTRY_CALLBACK_PATH, origin);
  url.searchParams.set(GENERAL_OAUTH_MARKER, "1");
  const safeNext = sanitizeNext(next);
  if (safeNext !== "/b2b") url.searchParams.set("next", safeNext);
  return url.toString();
}

const back = (reason: string) => `/auth/sign-in?error=${reason}`;

export async function completeGeneralOAuth(
  supabase: Client,
  params: { code: string | null; next: string | null; providerError: string | null },
): Promise<{ path: string }> {
  if (params.providerError || !params.code) return { path: back("oauth") };

  const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
  if (error || !data.user) {
    console.error(`general oauth: exchange failed (code ${(error as { code?: string } | null)?.code ?? "unknown"})`);
    return { path: back("oauth") };
  }

  let { data: state } = await supabase.rpc("my_registration_state");
  // A provider that returned no verified email cannot satisfy the registration gate (Facebook can omit it).
  if (state === "unverified") {
    await supabase.auth.signOut({ scope: "local" });
    return { path: back("oauth_email") };
  }
  if (state === "manually_blocked") return { path: "/auth/suspended" };

  // A first-time person: the button said "continue", under a notice that continuing accepts the Terms and Privacy Policy.
  if (state === "consent_pending") {
    const { error: consentError } = await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: "ar" });
    if (consentError) {
      await supabase.auth.signOut({ scope: "local" });
      return { path: back("oauth") };
    }
    ({ data: state } = await supabase.rpc("my_registration_state"));
  }

  if (state === "account_type_pending" || state === "username_pending") {
    const name = displayNameSchema.safeParse(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name);
    if (name.success) await supabase.rpc("profile_set_display_name", { p_display_name: name.data });
    return { path: FINISH_REGISTRATION_PATH };
  }

  return { path: await entryLandingPath(supabase, params.next) };
}
