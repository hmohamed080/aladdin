import { getPageContext } from "@/server/queries/page-context";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import { PageHeader, Panel } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { GaugeIcon } from "@/components/ui/icons";
import {
  getPointsBalance,
  listPointsEntries,
  resolveEntryOrganizationNames,
  resolveHistoryLimit,
  POINTS_HISTORY_LIMIT,
  POINTS_HISTORY_MAX,
} from "@/server/queries/points";
import { toPointsEntryViews } from "@/features/points/view-model";
import { PointsBalance } from "@/features/points/points-balance";
import { PointsHistory } from "@/features/points/points-history";

export const dynamic = "force-dynamic";

/**
 * Points — the caller's own standing, and how it changed.
 *
 * THE PAGE ANSWERS THREE QUESTIONS AND STOPS. How many Points do I have, why
 * did they change, and what does the programme mean today. Everything a
 * gamification dashboard would add — a tier, a level, a streak, a progress bar,
 * a leaderboard, a redeem button — is absent because no model backs it and the
 * approved specification excludes it.
 *
 * THIS IS "MY POINTS", STRUCTURALLY.
 * There is no user selector, no team view and no totals for anyone else, and
 * that is not enforced by this file: `public.points_ledger` has one owner policy
 * (`user_id = auth.uid()`), the query layer never accepts a user id, and
 * `points_balance()` is called with no argument so it defaults to the caller.
 * Manager and team visibility remain unresolved (D3) and no surface here
 * anticipates them.
 *
 * The route, the nav entry and the section it belongs to are unchanged from the
 * shell this replaces — only the body is new, exactly as the shell predicted.
 */
export default async function PointsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const m = getMessages(ctx.locale);
  const t = createTranslator(ctx.locale);
  const { show } = await searchParams;
  const limit = resolveHistoryLimit(show);

  const header = (
    <PageHeader
      locale={ctx.locale}
      Icon={GaugeIcon}
      title={m.points.title}
      subtitle={m.points.subtitle}
    />
  );

  /* One try around both reads, deliberately. They answer one question between
     them, and a page showing a confident balance above a silently empty history
     — or an empty state that is really a failed query — would be a page that
     lies about the ledger. If either read fails the page says so. */
  let balance: number;
  let entries: Awaited<ReturnType<typeof listPointsEntries>>;
  let orgNames: Map<string, string>;
  try {
    [balance, entries] = await Promise.all([
      getPointsBalance(ctx.supabase),
      listPointsEntries(ctx.supabase, { limit }),
    ]);
    orgNames = await resolveEntryOrganizationNames(ctx.supabase, entries);
  } catch {
    return (
      <div className="flex flex-col gap-lg">
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

  const views = toPointsEntryViews(entries, t, ctx.locale, orgNames);
  /* "More" appears only when the page is actually full AND the cap can still
     rise. A link that loads the same rows again is worse than no link. */
  const moreHref =
    entries.length >= limit && limit < POINTS_HISTORY_MAX
      ? `/b2b/points?show=${Math.min(limit + POINTS_HISTORY_LIMIT, POINTS_HISTORY_MAX)}`
      : null;

  return (
    <div className="flex flex-col gap-lg">
      {header}
      <PointsBalance balance={balance} locale={ctx.locale} t={t} />
      <Panel title={m.points.earn.title} Icon={GaugeIcon}>
        <div className="flex flex-col gap-1">
          <span className="text-label text-fg">{m.points.earn.ruleTitle}</span>
          <span className="text-body text-fg-secondary">{m.points.earn.ruleBody}</span>
          {/* The qualifying condition is stated in product language, not schema
              language: "a business new to Aladdin", never "salesperson_referral
              provenance". A person must be able to predict whether they will be
              paid without being told how the row is stored. */}
          <span className="text-caption text-fg-muted">{m.points.earn.ruleNote}</span>
        </div>
      </Panel>
      <Panel title={m.points.history.title} Icon={GaugeIcon}>
        <PointsHistory entries={views} t={t} moreHref={moreHref} />
      </Panel>
    </div>
  );
}
