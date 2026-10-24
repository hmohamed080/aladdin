import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";
import { displayNameSchema } from "@/features/auth-password-preview/password-policy";
import { sanitizeNext } from "@/server/auth/next";
import { claimGeneratedUsername, entryLandingPath } from "@/server/auth/phone-password";
import type { EntryKind } from "@/server/auth/entry-email";
import type { Database } from "@/types/database.types";

/**
 * Google and Facebook sign-in / sign-up on the Showroom and Installer entry
 * pages (docs/frontend/entry-auth-methods.md). Supabase Auth runs the OAuth
 * exchange (PKCE; the verifier lives in the SSR session cookies) and links a
 * provider identity to an existing user with the same verified email, so a
 * person keeps ONE user id whichever way they sign in.
 *
 * The page's kind only says which account type a BRAND-NEW person is creating;
 * an existing account is admitted only when the database's
 * `account_entry_allowed` agrees, so the Showroom/Installer separation holds
 * for OAuth exactly as it does for phone and email.
 */

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export type OAuthAvailability = Record<OAuthProvider, boolean>;

export const ENTRY_CALLBACK_PATH = "/auth/callback";
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
type Client = SupabaseClient<Database>;

export function isEntryKind(value: unknown): value is EntryKind {
  return value === "showroom" || value === "installer";
}

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export function entrySignInPath(kind: EntryKind): string {
  return kind === "showroom" ? "/sign-in" : "/installer/sign-in";
}

/** The callback URL handed to Supabase. Only the kind and a sanitized `next` ride it. */
export function entryCallbackUrl(origin: string, kind: EntryKind, next: unknown): string {
  const url = new URL(ENTRY_CALLBACK_PATH, origin);
  url.searchParams.set("entry", kind);
  const safeNext = sanitizeNext(next);
  if (safeNext !== "/b2b") url.searchParams.set("next", safeNext);
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
 * Finishes the OAuth round trip: exchanges the code for a session, sets up a
 * brand-new account for the page's kind, admits an existing one only when it
 * is that kind, and returns where to go next. Every refusal signs the session
 * out and returns to the kind's sign-in page with a reason (never provider
 * error text).
 */
export async function completeEntryOAuth(
  supabase: Client,
  params: { code: string | null; kind: EntryKind; next: string | null; providerError: string | null },
): Promise<EntryOAuthOutcome> {
  const back = (reason: string) => `${entrySignInPath(params.kind)}?error=${reason}`;
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

  // A NEW person: the button they pressed said "continue", under a notice
  // that continuing accepts the Terms and Privacy Policy.
  let created = false;
  if (state === "consent_pending") {
    const { error: consentError } = await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: "ar" });
    if (consentError) {
      logStepFailure("consent", consentError);
      return refuse("oauth");
    }
    ({ data: state } = await supabase.rpc("my_registration_state"));
  }
  if (state === "account_type_pending") {
    const { error: typeError } = await supabase.rpc("onboarding_select_account_type", {
      p_track: params.kind === "showroom" ? "business" : "professional",
      p_account_type: params.kind === "showroom" ? "showroom_dealer" : "installer_technician",
    });
    if (typeError) {
      logStepFailure("account_type", typeError);
      return refuse("oauth");
    }
    created = true;
    ({ data: state } = await supabase.rpc("my_registration_state"));
  }

  const { data: allowed, error: allowedError } = await supabase.rpc("account_entry_allowed", { p_kind: params.kind });
  if (allowedError || allowed !== true) return refuse("wrong_account");

  if (state === "username_pending") {
    const name = displayNameSchema.safeParse(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name);
    if (name.success) {
      const { error: nameError } = await supabase.rpc("profile_set_display_name", { p_display_name: name.data });
      if (nameError) logStepFailure("display_name", nameError);
    }
    if (!(await claimGeneratedUsername(supabase, params.kind))) return refuse("oauth");
  }

  if (created && params.kind === "showroom") return { path: "/onboarding/business" };
  return { path: await entryLandingPath(supabase, params.next) };
}
