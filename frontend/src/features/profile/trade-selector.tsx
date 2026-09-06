"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Badge, Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { ChoiceChip } from "@/features/onboarding/wizard";
import { StarIcon } from "@/components/ui/icons";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { setTradesAction, type TradesState } from "@/server/actions/trades";
import type { Trade, MyTrades } from "@/server/queries/trades";

const INITIAL: TradesState = { ok: false };

/**
 * Choosing the trades you work in.
 *
 * TWO DECISIONS, TWO CONTROLS, and keeping them apart is what makes the primary
 * legible. A chip answers "do I do this at all"; the star beside a selected chip
 * answers "is this the one I lead with". Folding both into one control — click
 * once to select, twice to promote — would make the second state invisible until
 * someone discovered it, on the field that a future job match reads first.
 *
 * IT SUBMITS THE WHOLE SELECTION, not the change. The form posts every selected
 * key and the primary as two hidden fields, and `user_trades_set` applies them
 * in one transaction. So a double-submit converges instead of toggling, and
 * there is no window in which the person holds two primaries or none —
 * see the action and the migration for why that is the database's job rather
 * than this component's.
 *
 * THE PRIMARY IS NEVER EMPTY WHILE SOMETHING IS SELECTED. Deselecting the
 * current primary promotes the first remaining chip here, exactly as the RPC
 * would if asked to choose — the two agree so the screen after a save is the
 * screen before it. Selecting the first trade makes it primary for the same
 * reason.
 *
 * THIS CARD SAVES ITSELF, and does not ride the profile form's button below it.
 * Trades are a different table with a different, atomic authority; one button
 * writing two RPCs would be two transactions that can disagree, and the page
 * would have to explain a half-saved profile. The availability control on the
 * hub already works this way for the same reason.
 *
 * NO RAW KEYS REACH THE SCREEN. Every visible string goes through `tradeLabel`,
 * which falls back to the key rather than to a message path — and the keys
 * themselves travel only in hidden inputs.
 */
export function TradeSelector({
  catalog,
  mine,
}: {
  catalog: Trade[];
  mine: MyTrades;
}) {
  const { t } = useI18n();
  const [state, submit] = useActionState(setTradesAction, INITIAL);

  const [selected, setSelected] = useState<string[]>(mine.keys);
  const [primary, setPrimary] = useState<string | null>(mine.primaryKey);

  const toggle = (key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        // Deselecting the primary promotes the first survivor rather than
        // leaving a selection with nothing leading it. Same rule the RPC applies
        // when no primary is named, so the two can never disagree.
        setPrimary((p) => (p === key ? (next[0] ?? null) : p));
        return next;
      }
      const next = [...prev, key];
      setPrimary((p) => p ?? key);
      return next;
    });
  };

  // Presented in the SAME order the profile and the public page use — primary
  // first, then the catalog's own order — so one professional's trades read
  // identically wherever they appear.
  const ordered = catalog
    .map((c) => c.key)
    .filter((k) => selected.includes(k))
    .sort((a, b) => Number(b === primary) - Number(a === primary));

  return (
    /* THE TEST HOOK IS ON A REAL ELEMENT, NOT ON `Card`. `data-*` props typecheck
       on any React component and are silently dropped unless the component
       forwards them — `Card` takes `className`, `pad` and `children` and nothing
       else, so a `data-testid` there compiles, passes review, and never reaches
       the DOM. Increment 4 hit this exact trap; the browser found it again here,
       because no unit test happened to query for it. */
    <Card className="flex flex-col gap-md">
      <div className="flex flex-col gap-1" data-testid="trade-selector">
        <h2 className="text-title text-fg">{t("profile.trades.title")}</h2>
        <p className="max-w-prose text-body text-fg-secondary">{t("profile.trades.body")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {catalog.map((trade) => (
          <ChoiceChip
            key={trade.key}
            selected={selected.includes(trade.key)}
            label={tradeLabel(t, trade.key)}
            onToggle={() => toggle(trade.key)}
          />
        ))}
      </div>

      {ordered.length > 0 ? (
        <div className="flex flex-col gap-sm">
          <h3 className="text-label font-medium text-fg-secondary">
            {t("profile.trades.selectedCount", { n: ordered.length })}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {ordered.map((key) => {
              const isPrimary = key === primary;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-strong/70 bg-surface-2/40 px-md py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-fg">{tradeLabel(t, key)}</span>
                    {isPrimary ? <Badge tone="accent">{t("profile.trades.primary")}</Badge> : null}
                  </span>
                  {/* The promote control is absent on the row that already holds
                      the state — a button that does nothing is worse than no
                      button, and its absence is itself the clearest statement of
                      which row is primary. */}
                  {isPrimary ? null : (
                    <button
                      type="button"
                      onClick={() => setPrimary(key)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                    >
                      <StarIcon size={14} />
                      {t("profile.trades.makePrimary")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="max-w-prose text-body text-fg-secondary" data-testid="trade-selector-empty">
          {t("profile.trades.emptyHint")}
        </p>
      )}

      {/* O5, said once where the choice is made. A tester who reads a trade list
          as a permission list will not take work outside it, and the platform
          would have taught them a restriction it does not impose. */}
      <p className="max-w-prose text-label text-fg-muted">{t("profile.trades.note")}</p>

      <form action={submit} className="flex flex-wrap items-center gap-sm">
        <input type="hidden" name="keys" value={ordered.join("\n")} />
        <input type="hidden" name="primary" value={primary ?? ""} />
        <SubmitButton variant="primary" size="sm" pendingLabel={t("profile.trades.saving")}>
          {t("profile.trades.save")}
        </SubmitButton>
        {state.ok ? <InlineSuccess>{t("profile.trades.saved")}</InlineSuccess> : null}
        {!state.ok && state.code ? <InlineError>{t(state.code)}</InlineError> : null}
      </form>
    </Card>
  );
}
