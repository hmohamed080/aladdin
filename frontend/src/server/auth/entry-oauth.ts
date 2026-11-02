import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import { displayNameSchema } from "@/features/auth-password-preview/password-policy";
import { sanitizeNext } from "@/server/auth/next";
import { entryLandingPath } from "@/server/auth/landing-path";
import type { Database } from "@/types/database.types";

/**
 * Google and Facebook sign-in / sign-up on /auth/sign-in and /auth/sign-up
 * (docs/frontend/entry-auth-methods.md). Supabase Auth runs the OAuth exchange
 * (PKCE; the verifier lives in the SSR session cookies) and links a provider
 * identity to an existing user with the same verified email, so a person keeps
 * ONE user id whichever way they sign in.
 *
 * One button both signs in and signs up. A brand-new person accepts the
 * Terms and Privacy Policy by continuing (the notice sits under the buttons),
 * then finishes registration (account type, username) on the canonical
 * finish-registration screen; an account type picked on the landing page
 * (`?type=`) is applied for them, after the server re-checks it.
 */

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type OAuthAvailability = Record<OAuthProvider, boolean>;

export const ENTRY_CALLBACK_PATH = "/auth/callback";
export const OAUTH_SIGN_IN_PATH = "/auth/sign-in";
const FINISH_REGISTRATION_PATH = "/auth/finish-registration";
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
type Client = SupabaseClient<Database>;

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** An open registration choice, or null. Never trusted beyond this lookup. */
export function openAccountType(value: unknown): string | null {
  const choice = typeof value === "string" ? CHOICES_BY_KEY[value] : undefined;
  return choice && !choice.comingSoon && !choice.transitional && choice.accountType ? choice.key : null;
}

/** The callback URL handed to Supabase. Only a sanitized `next` and an open account type ride it. */
export function entryCallbackUrl(origin: string, next: unknown, accountType?: unknown): string {
  const url = new URL(ENTRY_CALLBACK_PATH, origin);
  const safeNext = sanitizeNext(next);
  if (safeNext !== "/b2b") url.searchParams.set("next", safeNext);
  const type = openAccountType(accountType);
  if (type) url.searchParams.set("type", type);
  return url.toString();
}

/**
 * Which providers the Supabase project has switched on, from Auth's public
 * `/settings` endpoint (no secret involved). A provider that is off renders no
 * button, so nobody is sent into an OAuth error page before the dashboards are
 * configured. Cached for five minutes; any failure means "none".
 */
export async function oauthAvailability(fetcher: typeof fetch = fetch): Promise<OAuthAvailability> {
  const none: OAuthAvailability = { google: false, facebook: false };
  try {
    const env = readPublicEnv();
    const response = await fetcher(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      next: { revalidate: 300 },
    } as RequestInit);
    if (!response.ok) return none;
    const body = (await response.json()) as { external?: Partial<Record<string, unknown>> };
    return { google: body.external?.google === true, facebook: body.external?.facebook === true };
  } catch {
    return none;
  }
}

/** Safe diagnostics only: the step and a Postgres/GoTrue error code. */
function logStepFailure(step: string, error: { code?: string } | null | undefined): void {
  console.error(`entry oauth: ${step} failed (code ${error?.code ?? "unknown"})`);
}

export type EntryOAuthOutcome = { path: string; signedOut?: boolean };

/**
 * Finishes the OAuth round trip: exchanges the code for a session, records a
 * new person's consent (and the account type they picked, if any), and
 * returns where to go next. Every refusal returns to the sign-in page with a
 * reason (never provider error text).
 */
export async function completeEntryOAuth(
  supabase: Client,
  params: { code: string | null; next: string | null; accountType?: string | null; locale?: "en" | "ar"; providerError: string | null },
): Promise<EntryOAuthOutcome> {
  const back = (reason: string) => `${OAUTH_SIGN_IN_PATH}?error=${reason}`;
  if (params.providerError || !params.code) return { path: back("oauth") };

  const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
  if (error || !data.user) {
    logStepFailure("exchange", error as { code?: string } | null);
    return { path: back("oauth") };
  }

  const refuse = async (reason: string): Promise<EntryOAuthOutcome> => {
    await supabase.auth.signOut({ scope: "local" });
    return { path: back(reason), signedOut: true };
  };

  let { data: state } = await supabase.rpc("my_registration_state");
  // A provider that returned no verified email cannot satisfy the
  // registration gate (Facebook can omit it).
  if (state === "unverified") return refuse("oauth_email");
  if (state === "manually_blocked") return { path: "/auth/suspended" };

  if (state === "consent_pending") {
    const { error: consentError } = await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: params.locale ?? "en" });
    if (consentError) {
      logStepFailure("consent", consentError);
      return refuse("oauth");
    }
    ({ data: state } = await supabase.rpc("my_registration_state"));
  }

  const type = openAccountType(params.accountType);
  if (state === "account_type_pending" && type) {
    const choice = CHOICES_BY_KEY[type] as (typeof CHOICES_BY_KEY)[string];
    const { error: typeError } = await supabase.rpc("onboarding_select_account_type", {
      p_track: choice.track === "business" ? "business" : "professional",
      p_account_type: choice.accountType as string,
    });
    if (typeError) logStepFailure("account_type", typeError);
    ({ data: state } = await supabase.rpc("my_registration_state"));
  }

  if (state === "account_type_pending" || state === "username_pending") {
    // Prefill the name the provider knows; the person still confirms the rest.
    const name = displayNameSchema.safeParse(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name);
    if (name.success) {
      const { error: nameError } = await supabase.rpc("profile_set_display_name", { p_display_name: name.data });
      if (nameError) logStepFailure("display_name", nameError);
    }
    return { path: FINISH_REGISTRATION_PATH };
  }

  return { path: await entryLandingPath(supabase, params.next) };
}
