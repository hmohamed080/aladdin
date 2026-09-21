"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { BriefcaseIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { JobOpportunityCard } from "./job-opportunity-card";
import type { InstallerOpportunityVM } from "./view-model";

type SortKey = "match" | "distance" | "recent";

const SORTERS: Record<SortKey, { ar: string; en: string }> = {
  match: { ar: "مناسب لمهاراتي", en: "Best match" },
  distance: { ar: "قريب مني", en: "Nearest to me" },
  recent: { ar: "الأحدث", en: "Newest" },
};

export function JobOpportunitiesSection({
  opportunities,
  emptyTitle,
  emptyBody,
  viewAllHref,
  /** Match/distance sorting only makes sense where those fields exist (mock
   *  preview data); real opportunities carry neither, so production passes
   *  `sortable={false}` and the list simply stays in the query's own
   *  newest-first order rather than offering a control with nothing to sort. */
  sortable = true,
}: {
  opportunities: readonly InstallerOpportunityVM[];
  emptyTitle: string;
  emptyBody: string;
  viewAllHref?: string;
  sortable?: boolean;
}) {
  const { locale, dir } = useI18n();
  const [sort, setSort] = useState<SortKey>("match");
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  const jobs = useMemo(() => {
    if (!sortable) return opportunities;
    const list = [...opportunities];
    if (sort === "match") return list.sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
    if (sort === "distance") return list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    // "recent": already newest-first from the source.
    return list;
  }, [opportunities, sort, sortable]);

  return (
    <section id="opportunities" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-iris-solid/10 text-iris">
            <BriefcaseIcon size={17} />
          </span>
          <h2 className="text-headline text-fg">{locale === "ar" ? "فرص مناسبة لي" : "Opportunities for you"}</h2>
        </div>

        {sortable ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={locale === "ar" ? "ترتيب الفرص" : "Sort opportunities"}>
            {(Object.keys(SORTERS) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                className={cn(
                  "rounded-pill px-3.5 py-1.5 text-label font-medium transition-colors",
                  sort === key
                    ? "bg-iris-solid text-white"
                    : "border border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                )}
              >
                {locale === "ar" ? SORTERS[key].ar : SORTERS[key].en}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border bg-surface p-6 text-center shadow-card">
          <p className="text-title text-fg">{emptyTitle}</p>
          <p className="mt-1 text-body text-fg-secondary">{emptyBody}</p>
        </div>
      ) : (
        <ul className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {jobs.map((job) => (
            <JobOpportunityCard key={job.id} job={job} />
          ))}
        </ul>
      )}

      {viewAllHref ? (
        <div className="mt-3 flex justify-center">
          <Link href={viewAllHref} className="flex items-center gap-1 text-label font-medium text-iris hover:underline">
            {locale === "ar" ? "عرض كل فرص الشغل" : "View all opportunities"}
            <Forward size={14} />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
