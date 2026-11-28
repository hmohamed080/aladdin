import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getMessages } from "@/lib/i18n/translate";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { StatePanel } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { InstallerPointsHistory } from "@/features/installer-points/installer-points-history";
import { toPointsEntryViews } from "@/features/points/view-model";
import { getPointsOverview, listPointsHistoryPage, resolveEntryOrganizationNames } from "@/server/queries/points";
import { loadPointsHistoryAction } from "@/server/actions/points-history";

export const dynamic = "force-dynamic";

/** The last twelve Africa/Cairo calendar months, newest first ("YYYY-MM"). */
function lastMonths(count = 12): string[] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  let y = Number(parts.find((p) => p.type === "year")?.value);
  let m = Number(parts.find((p) => p.type === "month")?.value);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/**
 * `/home/points/history` - the full points ledger of the signed-in professional, in the approved Installer design
 * for Installers (keyset-paged, filtered in SQL, exact totals). Other professionals keep `/home/points?show=`.
 */
export default async function PointsHistoryRoute() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  if (home.variant !== "professional") return <NoProfessionalProfile />;
  if (home.accountType !== "installer_technician") redirect("/home/points?show=100");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const supabase = await getServerSupabase();
  try {
    const [overview, page] = await Promise.all([
      getPointsOverview(supabase),
      listPointsHistoryPage(supabase, { month: null, event: null, result: "all" }, null),
    ]);
    const names = await resolveEntryOrganizationNames(supabase, page.rows);
    return (
      <InstallerPointsHistory
        balance={overview.balance}
        months={lastMonths()}
        initial={{ views: toPointsEntryViews(page.rows, createTranslator(locale), locale, names), next: page.next, total: page.total }}
        load={loadPointsHistoryAction}
      />
    );
  } catch {
    return <StatePanel tone="danger" icon={<GaugeIcon size={22} />} title={m.points.error.title} body={m.points.error.body} />;
  }
}
