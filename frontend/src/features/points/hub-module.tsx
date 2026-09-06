import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { GaugeIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatPointsBalance } from "./view-model";

/**
 * The Points module on the Account Overview (Increment 14 — the redesign the
 * Reviews/Network module comments explicitly deferred to).
 *
 * Same shape as its siblings. The balance is `SUM(points_delta)`, faithful —
 * no clamping, no tier, no level, no redeem control — reusing the same
 * `formatPointsBalance` `/home/points` itself renders through, so the two
 * can never disagree.
 */
export function PointsModule({
  balance,
  locale,
  t,
}: {
  balance: number;
  locale: Locale;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <GaugeIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.points.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.points.body")}</p>

      <div className="flex items-end gap-3">
        <span className="text-headline tabular-nums text-fg">{formatPointsBalance(balance, locale)}</span>
        <span className="pb-1 text-label text-fg-secondary">{t("points.balance.unit")}</span>
      </div>

      <Link href="/home/points" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.points.manage")}
        </Button>
      </Link>
    </Card>
  );
}
