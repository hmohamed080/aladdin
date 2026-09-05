"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Panel } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { TabLinks } from "@/components/ui/stat-tiles";
import { UsersIcon } from "@/components/ui/icons";
import { RelationshipRow } from "./relationship-row";
import { PendingReferralRow } from "./pending-referral-row";
import type { NetworkRow, NetworkTab } from "@/lib/network/rows";

const INITIAL_VISIBLE = 4;

/**
 * The Network Directory — ONE continuous container for tabs, rows and their
 * "Show more" footer (revisit §5/§6/§9), replacing a page of separate
 * large-card organizations with the reference's single bordered list.
 *
 * SHOW MORE, NOT UNBOUNDED. Only `INITIAL_VISIBLE` rows render at first; the
 * rest were already fetched (real data, never a second round trip) and are
 * simply revealed on request. The revealed rows sit inside their own
 * `overflow-y-auto` region, capped at `desktop:max-h-[44rem]` — a REAL cap,
 * not merely a scroll-capable box with nothing to ever fill it. Below that
 * cap the region hugs its own content exactly as before (no visible
 * scrollbar for a short list); once revealed rows exceed it, the region
 * itself stops growing and scrolls internally instead of stretching the
 * Panel — which is what in turn keeps the shared grid row (§15, this
 * Directory next to Pending Invitations) from growing without bound too: a
 * capped box's `max-height` clamps its own contribution to the row's
 * auto-sized track, the same way an uncapped box's full content height used
 * to. The cap is `desktop:`-only on purpose — below that breakpoint the page
 * grid drops to one column and nothing needs a shared row height, so mobile
 * keeps stacking and growing naturally (§18). The tabs and the "Show more"
 * footer stay outside this scroll region on purpose (§9: "search, tabs,
 * hero and right rail must remain fixed").
 *
 * The caller remounts this component (via a `key` keyed to tab/search/trade)
 * on every filter change, which is what resets `visibleCount` back to
 * `INITIAL_VISIBLE` rather than carrying a stale "already expanded" state
 * into an unrelated result set.
 *
 * `t`/`locale` come from `useI18n()`, not a prop from the Server Component
 * above it — a function cannot cross the server→client boundary as a prop,
 * and `t` is one. Every client component in this tree (`FilterBar`,
 * `ResendButton`, …) already reads i18n the same way.
 */
export function NetworkDirectory({
  rows,
  totalNetworkCount,
  tab,
  tabCounts,
  q,
  trade,
}: {
  /** Already filtered for the active tab/search/trade. */
  rows: NetworkRow[];
  /** The whole network's row count, unconditioned by tab/search/trade — tells a true empty network apart from "no matches". */
  totalNetworkCount: number;
  tab: NetworkTab;
  tabCounts: { all: number; workedWith: number; referred: number; pending: number };
  q: string;
  trade: string;
}) {
  const { t, locale } = useI18n();
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const visible = rows.slice(0, visibleCount);
  const hasMore = rows.length > visibleCount;

  return (
    <Panel
      title={t("network.directory.title")}
      fill
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
      foot={
        hasMore ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleCount(rows.length)}
              data-testid="network-show-more"
              className="text-label font-medium text-accent hover:underline"
            >
              {t("network.list.showMore")}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="px-md pt-sm">
        <TabLinks
          basePath="/home/network"
          param="tab"
          current={tab === "all" ? "" : tab}
          label={t("network.tabs.label")}
          locale={locale}
          keep={{ q, trade }}
          tabs={[
            { value: "", label: t("network.tabs.all"), count: tabCounts.all },
            { value: "worked_with", label: t("network.tabs.workedWith"), count: tabCounts.workedWith },
            { value: "referred", label: t("network.tabs.referred"), count: tabCounts.referred },
            { value: "pending", label: t("network.tabs.pending"), count: tabCounts.pending },
          ]}
        />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-md pb-sm desktop:max-h-[44rem]"
        data-testid="network-list-scroll"
      >
        {rows.length === 0 ? (
          <StatePanel
            icon={totalNetworkCount === 0 ? <UsersIcon size={22} /> : undefined}
            title={totalNetworkCount === 0 ? t("network.empty.title") : t("network.noneMatch")}
            body={totalNetworkCount === 0 ? t("network.empty.body") : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-xs">
            {visible.map((row) => (
              <li key={row.kind === "organization" ? row.orgId : row.referral.id}>
                {row.kind === "organization" ? (
                  <RelationshipRow row={row} t={t} locale={locale} />
                ) : (
                  <PendingReferralRow referral={row.referral} t={t} locale={locale} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
