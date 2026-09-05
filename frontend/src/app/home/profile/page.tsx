import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { loadProfilePublication } from "@/server/queries/professional-profile";
import { loadMyTrades } from "@/server/queries/trades";
import { loadProfessionalAssetSummary } from "@/server/queries/portfolio";
import { loadMyReviewSummary } from "@/server/queries/reviews";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ProfileHub } from "@/features/profile/profile-hub";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";

export const dynamic = "force-dynamic";

/**
 * The professional profile hub — "my account" in the reference pack's sense: one
 * place that holds the professional identity, says what the public can see of it,
 * and leads to the editor.
 *
 * IT IS NOT A SECOND `/home`. The dashboard greets, says what to do next, and
 * shows the two account signals. This page answers a different question — *what
 * does my profile actually say, and who can see it* — which is why publication
 * state leads here and appears nowhere on the dashboard.
 *
 * A CONSUMER HAS NO PROFESSIONAL PROFILE, and is told so rather than redirected:
 * there is nothing wrong with the account, the page simply belongs to a different
 * kind of one. Same reasoning as `ShowroomNotAvailable`.
 */
export default async function ProfileHubPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  if (data.variant !== "professional") return <NoProfessionalProfile />;

  const [publication, trades, assets, reviews, network] = await Promise.all([
    loadProfilePublication(),
    loadMyTrades(),
    loadProfessionalAssetSummary(),
    loadMyReviewSummary(),
    listMyNetworkOrganizations(supabase),
  ]);

  return (
    <ProfileHub
      data={data}
      publication={publication}
      trades={trades}
      assets={assets}
      reviews={reviews}
      network={network}
      t={t}
    />
  );
}
