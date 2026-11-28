"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { CHOICES_BY_KEY } from "@/lib/onboarding/account-types";

const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;

export type ConsentState = { ok: boolean; code?: string };

/**
 * Record the required consents for a signed-in, verified user from the onboarding
 * handoff (used when a receipt is still outstanding). All three boxes must be
 * checked; the trusted `record_consent` RPC stamps the server-controlled version.
 */
export async function recordConsentAction(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const consented = CONSENT_TYPES.every((t) => formData.get(`consent_${t}`) === "on");
  if (!consented) return { ok: false, code: "auth.error.consentRequired" };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const { error } = await supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: locale });
  if (error) return { ok: false, code: "auth.error.consentRequired" };

  redirect("/onboarding");
}

export type AccountTypeChoiceState = { ok: boolean; code?: string };

/**
 * Shared with the canonical `/onboarding/account-type` picker's own server
 * action — this one exists for canonical password auth's
 * finish-registration recovery screen, reached when a pending-registration
 * write was lost before `account_type_completed_at` ever got set (see
 * `auth-password-preview.ts`'s `verifyPasswordSignUp`).
 */
export async function chooseAccountTypeAction(
  _prev: AccountTypeChoiceState,
  formData: FormData,
): Promise<AccountTypeChoiceState> {
  const key = formData.get("accountType");
  const choice = typeof key === "string" ? CHOICES_BY_KEY[key] : undefined;
  if (!choice || choice.comingSoon || choice.transitional) {
    return { ok: false, code: "authPasswordPreview.error.accountTypeRequired" };
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const { error } = await supabase.rpc("onboarding_select_account_type", {
    p_track: choice.track,
    // choice.accountType is only ever null for the transitional
    // "organization_owner_manager" entry, already excluded above -- this
    // ?? undefined is a type-level fallback, never a reachable runtime path.
    p_account_type: choice.accountType ?? undefined,
  });
  if (error) return { ok: false, code: "authPasswordPreview.error.accountTypeRequired" };

  redirect("/onboarding");
}
