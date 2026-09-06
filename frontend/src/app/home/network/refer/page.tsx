import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { searchOrganizationsForReferral } from "@/server/queries/network-referrals";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { NetworkReferralForm } from "@/features/network/referral-form";

export const dynamic = "force-dynamic";

/**
 * "Add a showroom I know" (§8). Two real paths: search for an organization
 * already on Aladdin, or describe one that is not. Neither grants access or
 * membership — see `network_referral_create_existing` /
 * `network_referral_create_new`.
 */
export default async function NetworkReferPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  const { q, error } = await searchParams;
  const query = (q ?? "").trim();
  const results = query.length >= 2 ? await searchOrganizationsForReferral(supabase, query) : [];

  return <NetworkReferralForm query={query} results={results} error={error} t={t} />;
}
