import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { searchOrganizationsForReferral } from "@/server/queries/network-referrals";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { NetworkReferralForm } from "@/features/network/referral-form";
import { ShowroomReferralBody, referralSaveErrorText } from "@/features/installer-network-preview/installer-showroom-referral-preview";
import { InlineError } from "@/components/ui/primitives";
import { createNewReferral } from "@/server/actions/network-referrals";

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
  if (!hasAppAccess(state)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const { q, error } = await searchParams;

  // An Installer gets the approved "Add a showroom I know" design (`/preview/installer-network/refer`), submitting to
  // the real referral path (pending Admin review; +100 Points when a new business is approved).
  if (home.accountType === "installer_technician") {
    return (
      <div className="flex w-full min-w-0 flex-col gap-md" data-installer-referral>
        <ShowroomReferralBody submitAction={createNewReferral} notice={error ? <InlineError>{referralSaveErrorText(locale)}</InlineError> : null} />
      </div>
    );
  }
  const query = (q ?? "").trim();
  const results = query.length >= 2 ? await searchOrganizationsForReferral(supabase, query) : [];

  return <NetworkReferralForm query={query} results={results} error={error} t={t} />;
}
