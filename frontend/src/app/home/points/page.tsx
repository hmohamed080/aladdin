import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { createTranslator, getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { StatePanel, Card } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";
import { HomeHeader, HomeSection } from "@/features/home/parts";
import { loadPointsPage } from "@/features/points/points-page";
import { PointsBalance } from "@/features/points/points-balance";
import { PointsHistory } from "@/features/points/points-history";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";

export const dynamic = "force-dynamic";

/**
 * Points, on the PERSONAL surface — the reachability fix for a feature that
 * shipped complete and then could not be opened by most of the people who hold it.
 *
 * `/b2b/points` was the only Points route, and `/b2b/layout.tsx` redirects a
 * caller with no organization to `/home`. An organization-less installer,
 * engineer or designer therefore held a real, user-owned balance in a real ledger
 * and had no door to it. Points are the caller's OWN standing — never an
 * organization record — so the personal home is where they always belonged; the
 * workspace copy is the one that exists for convenience.
 *
 * NOTHING ABOUT POINTS CHANGES HERE. No schema, no earning rule, no new event, no
 * wallet, tier, level, streak, progress bar, leaderboard or redeem control — the
 * approved contract excludes every one of those and this page adds none. The
 * reads, the failure contract, the history mapping and the negative-balance
 * behaviour are the shipped ones, shared through `features/points/points-page.ts`
 * so the two surfaces cannot drift.
 *
 * WHAT DIFFERS FROM `/b2b/points` IS CHROME ONLY. The workspace page uses the
 * dense `PageHeader`/`Panel` primitives; this one uses `HomeHeader`/`HomeSection`,
 * so it sits with `/home/profile` rather than importing the cockpit's density into
 * a surface that has no sidebar.
 *
 * READ AUTHORITY IS THE DATABASE'S, UNCHANGED. `points_ledger` has one owner
 * policy (`user_id = auth.uid()`), `points_balance()` is called with no argument,
 * and the query layer accepts no user id — so this route can no more reach another
 * person's ledger than the workspace one can.
 */
export default async function PersonalPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const m = getMessages(locale);

  // The same eligibility the rail uses. A consumer holds no Points under any
  // approved earning rule, so the destination is not theirs — stated, not
  // redirected, for the reason `NoProfessionalProfile` gives.
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const { show } = await searchParams;
  const data = await loadPointsPage(supabase, { show, locale, t, basePath: "/home/points" });

  const header = (
    <HomeHeader eyebrow={m.points.title} title={m.points.title} lead={m.points.subtitle} />
  );

  if (!data.ok) {
    return (
      <div className="flex flex-col gap-xl" data-testid="personal-points">
        {header}
        <StatePanel
          tone="danger"
          icon={<GaugeIcon size={22} />}
          title={m.points.error.title}
          body={m.points.error.body}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl" data-testid="personal-points">
      {header}

      <PointsBalance balance={data.balance} locale={locale} t={t} />

      <HomeSection title={m.points.earn.title}>
        <Card className="flex flex-col gap-1">
          <span className="text-label text-fg">{m.points.earn.ruleTitle}</span>
          <span className="text-body text-fg-secondary">{m.points.earn.ruleBody}</span>
          {/* Product language, not schema language: "a business new to Aladdin",
              never "salesperson_referral provenance". A person must be able to
              predict whether they will be credited without being told how the row
              is stored. Copy is the shipped one, unchanged. */}
          <span className="text-caption text-fg-muted">{m.points.earn.ruleNote}</span>
        </Card>
      </HomeSection>

      <HomeSection title={m.points.history.title}>
        <PointsHistory entries={data.views} t={t} moreHref={data.moreHref} />
      </HomeSection>
    </div>
  );
}
