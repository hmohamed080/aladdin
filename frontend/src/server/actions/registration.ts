"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";

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
