"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { menuItemClass, menuSurfaceClass } from "@/components/ui/menu";
import { JobOpportunityCard } from "./job-opportunity-card";
import type { InstallerOpportunityVM } from "./view-model";

type SortKey = "match" | "distance" | "recent";
type DateOrder = "newest" | "oldest";

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
}: {
  opportunities: readonly InstallerOpportunityVM[];
  emptyTitle: string;
  emptyBody: string;
  viewAllHref?: string;
  sortable?: boolean;
}) {
  const { locale, dir } = useI18n();
  const [sort, setSort] = useState<SortKey>("match");
  const [dateOrder, setDateOrder] = useState<DateOrder>("newest");
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  const jobs = useMemo(() => {
    if (!sortable) return opportunities;
    const list = [...opportunities];
    if (sort === "match") return list.sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
    if (sort === "distance") return list.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    // The source is newest-first, so the dropdown only needs to reverse it.
    return dateOrder === "oldest" ? list.reverse() : list;
  }, [dateOrder, opportunities, sort, sortable]);

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
            {QUICK_SORTS.map((key) => {
              const SortIcon = key === "distance" ? MapPinIcon : StarOutlineIcon;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  aria-pressed={sort === key}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-label font-medium transition-colors",
                    sort === key
                      ? "bg-primary text-primary-foreground"
                      : "border border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  <SortIcon size={15} aria-hidden="true" />
                  {locale === "ar" ? SORTERS[key].ar : SORTERS[key].en}
                </button>
              );
            })}

            <DateSortMenu
              value={dateOrder}
              active={sort === "recent"}
              onChange={(value) => {
                setDateOrder(value);
                setSort("recent");
              }}
            />
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
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = DATE_ORDERS.indexOf(value);
  const label = locale === "ar" ? "ترتيب حسب التاريخ" : "Sort by date";
  const optionLabel = (option: DateOrder) =>
    option === "newest"
      ? locale === "ar" ? "الأحدث" : "Newest"
      : locale === "ar" ? "الأقدم" : "Oldest";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) items.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index === DATE_ORDERS.length - 1 ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index === 0 ? DATE_ORDERS.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = DATE_ORDERS.length - 1;
    if (next === null) return;
    event.preventDefault();
    items.current[next]?.focus();
  };

  return (
    <div ref={root} className="relative inline-flex">
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

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            menuSurfaceClass,
            "absolute top-full z-popover mt-1 min-w-full w-36 py-1",
            dir === "rtl" ? "start-0" : "end-0",
          )}
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
                onKeyDown={(event) => onItemKeyDown(event, index)}
                className={menuItemClass(selected)}
              >
                <span className="min-w-0 flex-1">{optionLabel(option)}</span>
                {selected ? <CheckIcon size={14} className="shrink-0 text-accent" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
