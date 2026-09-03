"use client";

import { Card } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import { Stars } from "./parts";

/**
 * The review on the installer's own completed-assignment detail (§11).
 *
 * COMPACT, AND FIRST. It sits above the work record rather than below it,
 * because on a finished job the client's verdict is the newest thing that
 * happened — the progress history underneath is already settled.
 *
 * IT RENDERS ONLY WHEN A REVIEW EXISTS. The caller passes null otherwise and
 * nothing appears: work and review are distinct lifecycles, and this page is
 * about the work. There is deliberately no "awaiting review" state and no
 * "request a review" control — the professional cannot make a client write one,
 * and offering a button that does nothing would be worse than silence.
 *
 * The organization is not named here: this page already names who the work was
 * for, twice, and a third time would be noise.
 */
export function AssignmentReview({
  review,
  locale,
}: {
  review: { rating: number; comment: string | null; createdAt: string };
  locale: Locale;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <h2 className="text-title text-fg">{t("reviews.assignment.title")}</h2>
        <div className="flex items-center gap-2">
          <Stars value={review.rating} label={t("reviews.starsLabel", { n: review.rating })} />
          <span className="text-body-lg font-medium tabular-nums text-fg">{review.rating}</span>
        </div>
      </div>
      {review.comment ? (
        <p dir="auto" className="max-w-prose whitespace-pre-line text-body text-fg-secondary">
          {review.comment}
        </p>
      ) : null}
      <p className="text-label text-fg-muted">{formatDate(review.createdAt, locale)}</p>
    </Card>
  );
}
