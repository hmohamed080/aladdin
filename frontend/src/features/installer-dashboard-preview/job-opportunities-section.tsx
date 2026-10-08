"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  BriefcaseIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  StarOutlineIcon,
} from "@/components/ui/icons";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { menuItemClass } from "@/components/ui/menu";
import type { DashboardDateOrder, DashboardSort } from "@/lib/installer/dashboard-opportunities";
import { JobOpportunityCard } from "./job-opportunity-card";
import type { InstallerOpportunityVM } from "./view-model";

type SortKey = DashboardSort;
type DateOrder = DashboardDateOrder;

/**
 * SERVER-DRIVEN ORDERING (production). The section does not sort the cards it is given: it states which quick
 * filter is active and asks its owner to load that ordering from the database. Where this is absent (the preview)
 * the section sorts its fixture cards itself, as before.
 */
export type RemoteSort = {
  sort: SortKey;
  dateOrder: DateOrder;
  onChange: (sort: SortKey, dateOrder: DateOrder) => void;
  /** An ordering is being loaded: the cards on screen are the previous ones. */
  pending?: boolean;
  /** The last ordering could not be loaded; the cards on screen are unchanged. */
  failed?: boolean;
};

const SORTERS: Record<SortKey, { ar: string; en: string }> = {
  match: { ar: "مناسب لمهاراتي", en: "Best match" },
  distance: { ar: "قريب مني", en: "Nearest to me" },
  recent: { ar: "الأحدث", en: "Newest" },
};

const QUICK_SORTS: readonly Exclude<SortKey, "recent">[] = ["distance", "match"];

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
  /** The section heading. Defaults to the preview's "Opportunities for you";
   *  production passes an honest one, because a list of every open opening is
   *  not personalised. */
  title,
  /** "production" strips the card's demo-only interactions — see `JobOpportunityCard`. */
  variant = "preview",
  /** Production: the quick filters are real database orderings, loaded by the owner (see `RemoteSort`). */
  remoteSort,
  /** Production: which openings the caller has saved, and the persisted toggle (the same `saved_jobs` authority as /home/jobs). */
  save,
}: {
  opportunities: readonly InstallerOpportunityVM[];
  emptyTitle: string;
  emptyBody: string;
  viewAllHref?: string;
  sortable?: boolean;
  title?: string;
  variant?: "preview" | "production";
  remoteSort?: RemoteSort;
  save?: { isSaved: (id: string) => boolean; onToggle: (id: string) => void };
}) {
  const { locale, dir } = useI18n();
  const [sort, setSort] = useState<SortKey>("match");
  const [dateOrder, setDateOrder] = useState<DateOrder>("newest");
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  const showControls = sortable || Boolean(remoteSort);
  const activeSort = remoteSort ? remoteSort.sort : sort;
  const activeDateOrder = remoteSort ? remoteSort.dateOrder : dateOrder;
  const chooseSort = (key: Exclude<SortKey, "recent">) => (remoteSort ? remoteSort.onChange(key, activeDateOrder) : setSort(key));
  const chooseDateOrder = (value: DateOrder) => {
    if (remoteSort) remoteSort.onChange("recent", value);
    else {
      setDateOrder(value);
      setSort("recent");
    }
  };

  const jobs = useMemo(() => {
    if (!sortable || remoteSort) return opportunities;
    const list = [...opportunities];
    if (sort === "match") return list.sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
    if (sort === "distance") return list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    // The source is newest-first, so the dropdown only needs to reverse it.
    return dateOrder === "oldest" ? list.reverse() : list;
  }, [dateOrder, opportunities, remoteSort, sort, sortable]);

  return (
    <section id="opportunities" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-iris-solid/10 text-iris">
            <BriefcaseIcon size={17} />
          </span>
          <h2 className="text-headline text-fg">{title ?? (locale === "ar" ? "فرص مناسبة لي" : "Opportunities for you")}</h2>
        </div>

        {showControls ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={locale === "ar" ? "ترتيب الفرص" : "Sort opportunities"} aria-busy={remoteSort?.pending ? true : undefined}>
            {QUICK_SORTS.map((key) => {
              const SortIcon = key === "distance" ? MapPinIcon : StarOutlineIcon;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => chooseSort(key)}
                  aria-pressed={activeSort === key}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-label font-medium transition-colors",
                    activeSort === key
                      ? "bg-primary text-primary-foreground"
                      : "border border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  <SortIcon size={15} aria-hidden="true" />
                  {locale === "ar" ? SORTERS[key].ar : SORTERS[key].en}
                </button>
              );
            })}

            <DateSortMenu value={activeDateOrder} active={activeSort === "recent"} onChange={chooseDateOrder} />
          </div>
        ) : null}
      </div>

      {remoteSort?.failed ? (
        <p role="alert" className="mb-2 text-label font-medium text-danger">
          {locale === "ar" ? "تعذّر تحديث الفرص. حاول مرة أخرى." : "Could not update the opportunities. Please try again."}
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <div className="rounded-lg border bg-surface p-6 text-center shadow-card">
          <p className="text-title text-fg">{emptyTitle}</p>
          <p className="mt-1 text-body text-fg-secondary">{emptyBody}</p>
        </div>
      ) : (
        <ul className={cn("grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3", remoteSort?.pending && "opacity-70")} aria-busy={remoteSort?.pending ? true : undefined}>
          {jobs.map((job) => (
            <JobOpportunityCard
              key={job.id}
              job={job}
              variant={variant}
              save={save ? { saved: save.isSaved(job.id), onToggle: () => save.onToggle(job.id) } : undefined}
            />
          ))}
        </ul>
      )}

      {viewAllHref ? (
        <div className="mt-3 flex justify-center">
          <Link href={viewAllHref} className="flex items-center gap-1 text-label font-medium text-fg hover:underline">
            {locale === "ar" ? "عرض كل فرص الشغل" : "View all opportunities"}
            <Forward size={14} />
          </Link>
        </div>
      ) : null}
    </section>
  );
}

const DATE_ORDERS: readonly DateOrder[] = ["newest", "oldest"];

function DateSortMenu({
  value,
  active,
  onChange,
}: {
  value: DateOrder;
  active: boolean;
  onChange: (value: DateOrder) => void;
}) {
  const { locale, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = DATE_ORDERS.indexOf(value);
  const label = locale === "ar" ? "ترتيب حسب التاريخ" : "Sort by date";
  const optionLabel = (option: DateOrder) =>
    option === "newest"
      ? locale === "ar" ? "الأحدث" : "Newest"
      : locale === "ar" ? "الأقدم" : "Oldest";

  useEffect(() => {
    if (open) items.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  return (
    <div className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "inline-flex items-center gap-2 rounded-pill border px-3.5 py-1.5 text-label font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
        )}
      >
        <span>{optionLabel(value)}</span>
        <ChevronDownIcon size={15} aria-hidden="true" className={active ? "text-primary-foreground" : "text-fg-muted"} />
      </button>

      <FloatingMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        role="menu"
        aria-label={label}
        placement={dir === "rtl" ? "bottom-start" : "bottom-end"}
        matchAnchorWidth
        className="w-36 py-1"
      >
          {DATE_ORDERS.map((option, index) => {
            const selected = option === value;
            return (
              <button
                key={option}
                ref={(element) => {
                  items.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={menuItemClass(selected)}
              >
                <span className="min-w-0 flex-1">{optionLabel(option)}</span>
                {selected ? <CheckIcon size={14} className="shrink-0 text-accent" /> : null}
              </button>
            );
          })}
      </FloatingMenu>
    </div>
  );
}
