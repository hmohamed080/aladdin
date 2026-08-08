import "server-only";

import { getServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type OnboardingTrack = Database["public"]["Enums"]["onboarding_track"];
export type AccountTypeValue = Database["public"]["Enums"]["account_type"];

/**
 * The signed-in caller's saved onboarding data, for pre-filling the step forms and
 * rendering the handoff. Reads the shared profile, identity locale, verified email
 * (read-only on the contact step), and the self-owned onboarding_progress row.
 * Never trusts client input; returns null when signed out.
 */
export type OnboardingData = {
  email: string;
  displayName: string;
  locale: "en" | "ar";
  phone: string | null;
  selectedTrack: OnboardingTrack | null;
  selectedAccountType: AccountTypeValue | null;
};

export async function getOnboardingData(): Promise<OnboardingData | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: userRow }, { data: progress }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
    supabase.from("users").select("locale").eq("id", user.id).maybeSingle(),
    supabase
      .from("onboarding_progress")
      .select("phone, selected_track, selected_account_type")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    email: user.email ?? "",
    displayName: profile?.display_name ?? "",
    locale: userRow?.locale === "ar" ? "ar" : "en",
    phone: progress?.phone ?? null,
    selectedTrack: progress?.selected_track ?? null,
    selectedAccountType: progress?.selected_account_type ?? null,
  };
}
