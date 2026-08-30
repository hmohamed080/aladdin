import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatPointsBalance } from "@/features/points/view-model";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/ui/cn";

/**
 * The balance, stated once and plainly.
 *
 * NOT A WALLET CARD. No currency glyph, no available/pending split, no
 * conversion and no redeem affordance — Points are an engagement record, and the
 * moment this reads like money somebody will ask to withdraw it. The unit is a
 * WORD ("Points" / "نقطة") for the same reason: a symbol invites the comparison
 * a word does not.
 *
 * The figure is `SUM(points_delta)` straight from the database and is never
 * transformed on the way here — not clamped, not made absolute, and not replaced
 * by a dash when negative (D2). It borrows the KPI number treatment
 * (`font-display text-headline … tabular-nums`) so it sits in the same
 * typographic system as every other headline figure in the workspace.
 */
export function PointsBalance({
  balance,
  locale,
  t,
}: {
  balance: number;
  locale: Locale;
  t: TranslateFn;
}) {
  const negative = balance < 0;
  const figure = formatPointsBalance(balance, locale);
  return (
    <Card>
      <section aria-labelledby="points-balance-label">
        <h2 id="points-balance-label" className="text-label text-fg-muted">
          {t("points.balance.label")}
        </h2>
        {/* The figure and its unit are ONE accessible string: a screen reader
            announcing "minus forty" with no unit is not an answer to "how many
            Points do I have". `aria-label` carries the sentence; the visual
            treatment keeps the number dominant. */}
        <p
          className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2"
          aria-label={t("points.balance.description", { amount: figure })}
        >
          <span
            aria-hidden="true"
            className={cn(
              "min-w-0 break-words font-display text-headline leading-tight tabular-nums",
              negative ? "text-danger" : "text-fg",
            )}
          >
            {figure}
          </span>
          <span aria-hidden="true" className="shrink-0 text-label text-fg-muted">
            {t("points.balance.unit")}
          </span>
        </p>
        {/* The negative state is carried by a SENTENCE, not only by the colour
            above — and the sign is already inside the figure itself, so the
            state survives greyscale and colour-vision deficiency. */}
        {negative ? (
          <p className="mt-2 text-caption text-fg-secondary">{t("points.balance.negativeHint")}</p>
        ) : null}
      </section>
    </Card>
  );
}
