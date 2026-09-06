"use client";

import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";
import { StarIcon } from "@/components/ui/icons";
import { tradeLabel } from "@/lib/i18n/trade-label";
import type { MyTrades } from "@/server/queries/trades";

/**
 * The read-only view of a trade selection — the hub, and anywhere else a
 * professional's trades are STATED rather than chosen.
 *
 * SEPARATE FROM `TradeSelector` ON PURPOSE. Sharing a module meant every page
 * that merely DISPLAYS trades imported the save action behind it, and through it
 * `server-only` — which is a runtime error in any client render, and which a
 * component test could only get past by mocking an action it never calls.
 *
 * The primary leads and is marked; the rest follow as plain chips under a label
 * that says what they are. A flat list of equal badges would lose the one
 * distinction the model actually carries.
 */
export function TradeSummary({
  trades,
  emptyAction,
}: {
  trades: MyTrades;
  /** Rendered beside the empty state — the way out, not a decoration. */
  emptyAction?: React.ReactNode;
}) {
  const { t } = useI18n();

  if (trades.keys.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-md" data-testid="trade-summary-empty">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-fg">{t("profile.trades.empty")}</p>
          <p className="max-w-prose text-label text-fg-secondary">{t("profile.trades.emptyHint")}</p>
        </div>
        {emptyAction}
      </div>
    );
  }

  const rest = trades.keys.filter((k) => k !== trades.primaryKey);

  return (
    <div className="flex flex-col gap-md" data-testid="trade-summary">
      {trades.primaryKey ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-fg-muted">{t("profile.trades.mainLabel")}</span>
          <span className="flex items-center gap-2">
            <StarIcon size={16} className="shrink-0 text-accent" />
            <span className="text-body-lg font-medium text-fg">{tradeLabel(t, trades.primaryKey)}</span>
          </span>
        </div>
      ) : null}

      {rest.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-label text-fg-muted">{t("profile.trades.alsoLabel")}</span>
          <ul className="flex flex-wrap gap-1.5">
            {rest.map((key) => (
              <li key={key}>
                <Badge tone="neutral">{tradeLabel(t, key)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
