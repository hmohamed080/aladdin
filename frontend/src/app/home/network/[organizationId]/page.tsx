import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getNetworkOrganization, listNetworkWorkHistory } from "@/server/queries/network";
import { listMyNetworkReferrals } from "@/server/queries/network-referrals";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { BackLink } from "@/features/sales/page-parts";
import { OrganizationDetail } from "@/features/network/organization-detail";
import type { OrganizationRow } from "@/lib/network/rows";

export const dynamic = "force-dynamic";

/**
 * One organization of the installer's real network — completed work, a
 * joined referral, or both (§13).
 *
 * `notFound()` covers every reason this could fail as ONE reason: the id is
 * not real, the caller has neither completed work nor a joined referral for
 * it, or the caller is not signed in as the professional who does. Both
 * reads are scoped to `auth.uid()` inside their own definers with no
 * parameter — THE URL IS NEVER THE AUTHORITY.
 */
export default async function NetworkOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const registration = await getRegistrationState();
  if (registration === "unverified") redirect("/auth/sign-in");
  if (registration !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const { organizationId } = await params;
  const [completedWork, referrals] = await Promise.all([
    getNetworkOrganization(supabase, organizationId),
    listMyNetworkReferrals(supabase),
  ]);
  const referral =
    referrals.find((r) => r.status === "joined" && r.organizationId === organizationId) ?? null;

  if (!completedWork && !referral) notFound();

  const row: OrganizationRow = {
    kind: "organization",
    orgId: organizationId,
    orgName: completedWork?.orgName ?? referral?.organizationName ?? "",
    completedWork,
    referral,
  };

  const history = completedWork ? await listNetworkWorkHistory(supabase, organizationId) : [];

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" data-testid="network-organization-page">
      <BackLink href="/home/network">{t("network.detail.back")}</BackLink>
      <OrganizationDetail row={row} history={history} reviewCount={completedWork?.reviewCount ?? 0} t={t} locale={locale} />
    </div>
  );
}
