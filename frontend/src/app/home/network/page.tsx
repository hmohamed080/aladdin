import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { listMyNetworkOrganizations } from "@/server/queries/network";
import { listMyNetworkReferrals } from "@/server/queries/network-referrals";
import { getPointsBalance } from "@/server/queries/points";
import { summarizeNetwork } from "@/lib/network/summary";
import {
  buildNetworkRows,
  filterNetworkRows,
  countNetworkRows,
  countReferralStats,
  type NetworkTab,
} from "@/lib/network/rows";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { NetworkPage } from "@/features/network/network-page";

export const dynamic = "force-dynamic";

const TAB_VALUES: readonly NetworkTab[] = ["all", "worked_with", "referred", "pending"];

/**
 * `/home/network` — the installer's real professional network: completed
 * work AND real showroom referrals, never merged into one fake state.
 *
 * THE SUMMARY IS ALWAYS COMPLETED-WORK-ONLY (§7), computed from
 * `listMyNetworkOrganizations` alone. Everything else on the page reads the
 * MERGED rows from `lib/network/rows`, so a pending or joined referral can
 * never move the four headline numbers.
 */
export default async function NetworkRoute({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; trade?: string; tab?: string }>;
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
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const [organizations, referrals, pointsBalance] = await Promise.all([
    listMyNetworkOrganizations(supabase),
    listMyNetworkReferrals(supabase),
    getPointsBalance(supabase),
  ]);

  const summary = summarizeNetwork(organizations);
  const allRows = buildNetworkRows(organizations, referrals);
  const tabCounts = countNetworkRows(allRows);
  const { referredOrgsCount, showroomsAddedCount } = countReferralStats(referrals);

  const tradeKeys = [...new Set(organizations.flatMap((o) => o.tradeKeys))].sort();
  const tradeOptions = tradeKeys.map((key) => ({ key, label: tradeLabel(t, key) }));

  const { q, trade, tab: tabRaw } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const tradeFilter = trade && tradeKeys.includes(trade) ? trade : "";
  const tab: NetworkTab = TAB_VALUES.includes((tabRaw ?? "all") as NetworkTab)
    ? ((tabRaw ?? "all") as NetworkTab)
    : "all";

  const byTab = filterNetworkRows(allRows, tab);
  const shown = byTab.filter((row) => {
    const name = row.kind === "organization" ? row.orgName : row.referral.displayName;
    if (query && !(name ?? "").toLowerCase().includes(query)) return false;
    if (tradeFilter) {
      if (row.kind !== "organization" || !row.completedWork) return false;
      if (!row.completedWork.tradeKeys.includes(tradeFilter)) return false;
    }
    return true;
  });

  const pendingPreview = referrals.filter((r) => r.status === "pending").slice(0, 3);

  return (
    <NetworkPage
      rows={shown}
      summary={summary}
      tab={tab}
      tabCounts={tabCounts}
      q={q ?? ""}
      trade={tradeFilter}
      tradeOptions={tradeOptions}
      pointsBalance={pointsBalance}
      referredOrgsCount={referredOrgsCount}
      showroomsAddedCount={showroomsAddedCount}
      pendingPreview={pendingPreview}
      t={t}
      locale={locale}
    />
  );
}
