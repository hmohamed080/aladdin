import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { StarIcon } from "@/components/ui/icons";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { RatingSummary } from "@/lib/reviews/summary";
import { Stars } from "./parts";

/**
 * The reviews module on the profile hub (§12).
 *
 * Same shape as the portfolio and certificate cards beside it — icon, title, one
 * line, a large number, one action — because `04-account-overview.jpeg` keeps
 * them at one level and this is not the Account Overview redesign.
 *
 * ZERO REVIEWS SHOWS NO NUMBER AT ALL. The reference's equivalent card leads
 * with 4.8; a fresh professional would have to lead with 0.0, which reads as a
 * terrible score rather than as an empty one. So the card says what reviews are
 * and where they come from, and the numeral appears only once there is one.
 */
export function ReviewsModule({
  summary,
  t,
}: {
  summary: RatingSummary;
  t: TranslateFn;
}) {
  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center gap-2">
        <StarIcon size={18} className="shrink-0 text-fg-secondary" />
        <h3 className="text-title text-fg">{t("profile.reviews.title")}</h3>
      </div>
      <p className="text-label text-fg-secondary">{t("profile.reviews.body")}</p>

      {summary.average === null ? (
        <p className="text-label text-fg-muted">{t("profile.reviews.none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <span className="text-headline tabular-nums text-fg">
              {summary.average.toFixed(1)}
            </span>
            <span className="pb-1 text-label text-fg-secondary">
              {t("reviews.basedOn", { n: summary.total })}
            </span>
          </div>
          <Stars
            value={summary.average}
            label={t("reviews.starsLabel", { n: summary.average })}
          />
        </div>
      )}

      <Link href="/home/reviews" className="mt-auto">
        <Button type="button" variant="outline">
          {t("profile.reviews.manage")}
        </Button>
      </Link>
    </Card>
  );
}
