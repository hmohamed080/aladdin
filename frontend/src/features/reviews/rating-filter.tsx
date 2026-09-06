"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { RatingSummary } from "@/lib/reviews/summary";

/**
 * The one filter this page has: all, or a single star value.
 *
 * LINKS, NOT STATE. Each choice is a real URL, so a filtered view can be
 * bookmarked, opened in a new tab and reached by the back button — and the page
 * stays a server component that reads the filter from its own query string.
 * A client-side filter would have been fewer lines and would have thrown all of
 * that away.
 *
 * A STAR WITH NO REVIEWS IS NOT OFFERED. Rendering "2 stars" as a dead end that
 * yields an empty list would waste the reader's click to tell them something the
 * distribution above already showed them.
 */
export function RatingFilter({
  summary,
  active,
}: {
  summary: RatingSummary;
  active: number | null;
}) {
  const { t } = useI18n();
  const available = ([5, 4, 3, 2, 1] as const).filter((s) => summary.distribution[s] > 0);

  // With one star value in play the control would offer "all" and the only thing
  // there is — a choice between a set and itself.
  if (available.length < 2) return null;

  const chip = (isActive: boolean) =>
    cn(
      "inline-flex min-h-8 items-center rounded-pill border px-3 text-label font-medium transition-colors duration-fast",
      isActive
        ? "border-accent bg-accent text-on-accent"
        : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
    );

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label={t("reviews.filterLabel")}>
      <Link href="/home/reviews" className={chip(active === null)} scroll={false}>
        {t("reviews.filterAll")}
      </Link>
      {available.map((stars) => (
        <Link
          key={stars}
          href={`/home/reviews?rating=${stars}`}
          className={chip(active === stars)}
          scroll={false}
        >
          {t("reviews.starsRow", { n: stars })}
        </Link>
      ))}
    </nav>
  );
}
