import { Card } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { FilterBar } from "@/components/ui/filter-bar";
import { UsersIcon, ClipboardIcon, TrendingUpIcon, LayersIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import type { NetworkSummary } from "@/lib/network/summary";
import type { NetworkRow, NetworkTab } from "@/lib/network/rows";
import { ReferralHero } from "./referral-hero";
import { NetworkDirectory } from "./network-directory";
import { NetworkPointsPanel } from "./points-panel";
import { PendingInvitationsPanel } from "./pending-panel";
import type { NetworkReferral } from "@/server/queries/network-referrals";

/**
 * `/home/network`.
 *
 * COMPOSITION rebuilt toward `06-showroom-network.jpeg` as a geometry target,
 * not only an information-hierarchy one (revisit brief §1):
 *
 *   compact header -> compact summary STRIP (§2)
 *   -> a 2x2 page grid, same column template both rows (§15):
 *        [ referral hero + search, ONE bounded panel (§4) ] [ Network Points ]
 *        [ Network Directory: tabs + rows + Show more (§5/§6/§9) ] [ Pending Invitations ]
 *
 * The lower row shares one row height by construction — both panels use
 * `Panel`'s `fill` (so each stretches to the row's own height) and `foot`
 * (so "Show more" / "View all invitations" both anchor to the bottom of
 * whichever panel is taller) — never a fixed `min-height` or filler content.
 *
 * MOBILE reorders the same four blocks via `order-*` rather than a second
 * layout: hero+search, then the Directory (the real list), THEN Points, then
 * Pending — so the actual network is not buried under a rail card (§18).
 *
 * TWO AUTHORITIES, NEVER MERGED. The summary strip stays completed-work-only
 * (§7 of the original brief) — a pending or joined referral never inflates
 * it. Everything else on the page reads the MERGED rows
 * (`lib/network/rows`), where a referral and a completed-work relationship
 * are allowed to describe the SAME organization without either pretending to
 * be the other.
 */
export function NetworkPage({
  rows,
  summary,
  tab,
  tabCounts,
  q,
  trade,
  tradeOptions,
  pointsBalance,
  referredOrgsCount,
  showroomsAddedCount,
  pendingPreview,
  t,
  locale,
}: {
  /** Already filtered for the active tab/search/trade. */
  rows: NetworkRow[];
  /** Of the WHOLE network, never the filtered subset — completed work only. */
  summary: NetworkSummary;
  tab: NetworkTab;
  tabCounts: { all: number; workedWith: number; referred: number; pending: number };
  q: string;
  trade: string;
  tradeOptions: { key: string; label: string }[];
  pointsBalance: number;
  /** Distinct organizations joined through the caller's referral — real. */
  referredOrgsCount: number;
  /** Not-yet-registered showrooms the caller has referred — real. */
  showroomsAddedCount: number;
  pendingPreview: readonly NetworkReferral[];
  t: TranslateFn;
  locale: Locale;
}) {
  const tiles: Tile[] = [
    { label: t("network.summary.organizations"), value: summary.organizationCount, Icon: UsersIcon, tone: "accent" },
    { label: t("network.summary.completed"), value: summary.completedTotal, Icon: ClipboardIcon, tone: "success" },
    { label: t("network.summary.repeat"), value: summary.repeatCount, Icon: TrendingUpIcon, tone: "info" },
    { label: t("network.summary.trades"), value: summary.tradeCount, Icon: LayersIcon },
  ];

  return (
    <div className="flex flex-col gap-md" data-testid="network-page">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-title text-fg">{t("network.title")}</h1>
        <p className="max-w-prose text-label text-fg-secondary">{t("network.subtitle")}</p>
      </div>

      {/* ONE compact horizontal instrument, not four floating cards (§2). */}
      <StatTiles tiles={tiles} locale={locale} layout="strip" columns={4} />

      <div className="grid gap-md [&>*]:min-w-0 desktop:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="order-1 desktop:order-none desktop:self-start">
          {/* Hero and search as ONE bounded panel — one surface, one radius, one shadow (§4). */}
          <Card pad="sm" className="flex flex-col gap-sm" data-testid="network-discovery-panel">
            <ReferralHero t={t} />
            <div className="border-t pt-sm">
              <FilterBar
                variant="flush"
                basePath="/home/network"
                search={{ name: "q", value: q, placeholder: t("network.searchPlaceholder") }}
                selects={
                  tradeOptions.length > 1
                    ? [
                        {
                          name: "trade",
                          label: t("network.tradeLabel"),
                          value: trade,
                          anyLabel: t("network.allTrades"),
                          options: tradeOptions.map((o) => ({ value: o.key, label: o.label })),
                        },
                      ]
                    : []
                }
                clearLabel={t("network.clear")}
              />
            </div>
          </Card>
        </div>

        <div className="order-3 desktop:order-none desktop:self-start">
          <NetworkPointsPanel
            pointsBalance={pointsBalance}
            referredOrgsCount={referredOrgsCount}
            showroomsAddedCount={showroomsAddedCount}
            t={t}
            locale={locale}
          />
        </div>

        <div className="order-2 desktop:order-none">
          <NetworkDirectory
            key={`${tab}|${q}|${trade}`}
            rows={rows}
            totalNetworkCount={tabCounts.all}
            tab={tab}
            tabCounts={tabCounts}
            q={q}
            trade={trade}
          />
        </div>

        <div className="order-4 desktop:order-none">
          <PendingInvitationsPanel
            pendingReferrals={pendingPreview}
            pendingTotal={tabCounts.pending}
            t={t}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}
