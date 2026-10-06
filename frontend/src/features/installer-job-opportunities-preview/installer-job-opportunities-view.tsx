"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePhoneLayout } from "@/lib/ui/use-phone-layout";
import { Button } from "@/components/ui/controls";
import { FilterIcon, HeartFilledIcon, SearchIcon, XIcon } from "@/components/ui/icons";
import { StatePanel } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { OpportunityCard } from "./opportunity-card";
import { OpportunityFilters } from "./opportunity-filters";
import {
  activeFilterCount,
  type BoardFilters,
  type BoardSort,
  type JobCardVM,
  type PreviewInteractions,
  type TradeOption,
} from "./view-model";

const SORT_LABELS: Record<BoardSort, { ar: string; en: string }> = {
  newest: { ar: "الأحدث", en: "Newest" },
  nearest: { ar: "الأقرب لي", en: "Nearest" },
  highest: { ar: "الأعلى أجرًا", en: "Highest pay" },
  demanded: { ar: "الأكثر طلبًا", en: "Most requested" },
};

const INITIAL_VISIBLE = 6;

/**
 * THE SHARED JOB BOARD — the approved presentation, and the only one.
 *
 * It renders CONTENT ONLY (header, sort, filters, grid): no sidebar, no topbar,
 * no `<main>`. The preview wraps it in its own shell; production gets the shell
 * from `app/home/layout.tsx`, so rendering chrome here would draw it twice.
 *
 * It is CONTROLLED. `filters` and `sort` come in, `onFiltersChange` /
 * `onSortChange` go out, and the View holds no copy of either. Production wires
 * them to the URL (the server then runs the real query); the preview wires them to
 * local state over fixtures.
 *
 * `preview` is the whole difference between the two: when present the save heart,
 * the local Apply button, the map, the radius, the budget slider and the "Saved
 * opportunities" button are shown. Production never passes it, so none of them
 * exist there.
 */
export function InstallerJobOpportunitiesView({
  opportunities,
  countLabel,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  sortOptions,
  tradeOptions,
  governorates,
  subtitle,
  headerAction,
  preview,
  scroll,
  pending = false,
}: {
  /** Already filtered and ordered by the adapter (production: by the real query). */
  opportunities: readonly JobCardVM[];
  /** The finished count sentence — the adapter alone knows whether it is exact. */
  countLabel: string;
  filters: BoardFilters;
  onFiltersChange: (next: BoardFilters) => void;
  sort: BoardSort;
  onSortChange: (next: BoardSort) => void;
  sortOptions: readonly BoardSort[];
  tradeOptions: readonly TradeOption[];
  governorates: readonly string[];
  subtitle?: string;
  /** Production: the "My applications" link. The preview passes its saved-jobs button. */
  headerAction?: ReactNode;
  preview?: PreviewInteractions;
  /** "contained": the preview's fixed-viewport columns. "page": ordinary page scroll with a sticky filter rail. */
  scroll: "contained" | "page";
  pending?: boolean;
}) {
  const { locale, dir, t } = useI18n();
  const ar = locale === "ar";
  const phone = usePhoneLayout();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const effectiveView = phone ? "grid" : view;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const stateKey = JSON.stringify([filters, sort, preview?.savedOnly ?? false]);
  const expanded = expandedKey === stateKey;
  const visible = expanded ? opportunities : opportunities.slice(0, INITIAL_VISIBLE);
  const contained = scroll === "contained";

  const count = activeFilterCount(filters, Boolean(preview), preview?.budgetCeiling);
  const narrowedAnyway = count > 0 || Boolean(preview?.savedOnly);

  // Below `wide` the filters are a bottom sheet: Escape closes it and the page
  // behind does not scroll while it is open.
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    const narrow = window.matchMedia("(max-width: 1439px)").matches;
    if (narrow) document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [filtersOpen]);

  return (
    <div
      data-installer-opportunities-root=""
      className={cn("flex min-h-0 flex-1 flex-col gap-md", contained && "wide:overflow-hidden")}
    >
      <header className="flex shrink-0 flex-col gap-sm tablet:flex-row tablet:items-end tablet:justify-between">
        <div>
          <h1 className="text-headline text-fg">{ar ? "فرص الشغل" : "Job opportunities"}</h1>
          <p className="mt-1 max-w-2xl text-body text-fg-secondary">
            {subtitle ?? (ar ? "اكتشف فرص الشغل المناسبة لمهاراتك وقدّم عليها بسهولة" : "Discover work opportunities that fit your skills and apply with ease.")}
          </p>
        </div>
        {preview ? (
          <Button
            variant={preview.savedOnly ? "primary" : "outline"}
            className="gap-2 self-start tablet:self-auto"
            aria-pressed={preview.savedOnly}
            onClick={() => preview.onSavedOnlyChange(!preview.savedOnly)}
          >
            <HeartFilledIcon size={17} className="text-danger" />
            {ar ? "فرص محفوظة" : "Saved opportunities"}
            <span className="tabular-nums">{preview.savedIds.size}</span>
          </Button>
        ) : (
          headerAction
        )}
      </header>

      <div className="flex shrink-0 flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-between">
        <div role="group" aria-label={ar ? "ترتيب الفرص" : "Sort opportunities"} className="flex min-w-0 overflow-x-auto rounded-sm border bg-surface p-1 shadow-card">
          {sortOptions.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              onClick={() => onSortChange(value)}
              className={cn(
                "min-w-max rounded-xs px-3 py-2 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                sort === value ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-2 hover:text-fg",
              )}
            >
              {ar ? SORT_LABELS[value].ar : SORT_LABELS[value].en}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-sm">
          <Button variant={count > 0 ? "primary" : "outline"} size="sm" className="w-full justify-center gap-2 tablet:w-auto wide:hidden" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen} aria-haspopup="dialog">
            <FilterIcon size={16} />
            {ar ? "الفلاتر" : "Filters"}
            {count > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-pill bg-primary-foreground px-1 text-caption font-bold tabular-nums text-primary">{formatCount(count, locale)}</span> : null}
          </Button>
          <div className="inline-flex rounded-sm border bg-surface p-1 shadow-card max-tablet:hidden" role="group" aria-label={ar ? "طريقة عرض الفرص" : "Opportunity view"}>
            <ViewButton active={view === "grid"} label={ar ? "عرض شبكي" : "Grid view"} onClick={() => setView("grid")}><GridViewIcon /></ViewButton>
            <ViewButton active={view === "list"} label={ar ? "عرض قائمة" : "List view"} onClick={() => setView("list")}><ListViewIcon /></ViewButton>
          </div>
        </div>
      </div>

      <div dir="ltr" className={cn("grid min-h-0 flex-1 items-start gap-md wide:grid-cols-[minmax(0,1fr)_18rem]", contained && "wide:overflow-hidden")}>
        <section dir={dir} aria-live="polite" aria-busy={pending || undefined} className={cn("min-w-0", contained && "wide:h-full wide:min-h-0 wide:overflow-y-auto wide:pe-sm", pending && "opacity-70 transition-opacity")}>
          <div className="mb-sm flex items-center justify-between gap-sm">
            <p className="text-label text-fg-secondary">{countLabel}</p>
            {preview?.savedOnly ? <span className="text-label font-medium text-accent">{ar ? "المحفوظة فقط" : "Saved only"}</span> : null}
          </div>

          {visible.length === 0 ? (
            preview ? (
              <StatePanel
                icon={<SearchIcon size={20} />}
                title={ar ? "لا توجد فرص بهذه الفلاتر" : "No opportunities match these filters"}
                body={ar ? "جرّب توسيع نطاق الموقع أو تعديل نوع العمل والميزانية." : "Try widening the location radius or adjusting work type and budget."}
              />
            ) : (
              <StatePanel
                icon={<SearchIcon size={20} />}
                title={t(narrowedAnyway ? "jobs.opportunities.noResultsTitle" : "jobs.opportunities.emptyTitle")}
                body={t(narrowedAnyway ? "jobs.opportunities.noResultsBody" : "jobs.opportunities.emptyBody")}
              />
            )
          ) : (
            <ul className={cn("grid gap-md", effectiveView === "grid" ? "tablet:grid-cols-2 wide:grid-cols-3" : "grid-cols-1")}>
              {visible.map((job) => (
                <li key={job.id} className="min-w-0">
                  <OpportunityCard
                    job={job}
                    locale={locale}
                    view={effectiveView}
                    preview={
                      preview
                        ? {
                            saved: preview.savedIds.has(job.id),
                            applied: preview.appliedIds.has(job.id),
                            onToggleSaved: () => preview.onToggleSaved(job.id),
                            onApply: () => preview.onApply(job.id),
                          }
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          {!expanded && opportunities.length > INITIAL_VISIBLE ? (
            <div className="mt-lg flex justify-center">
              <Button variant="outline" onClick={() => setExpandedKey(stateKey)}>
                {ar ? "عرض المزيد من الفرص" : "View more opportunities"}
              </Button>
            </div>
          ) : null}
        </section>

        {filtersOpen ? <div className="fixed inset-0 z-modal bg-primary/50 wide:hidden" aria-hidden="true" onClick={() => setFiltersOpen(false)} /> : null}
        <div
          dir={dir}
          role={filtersOpen ? "dialog" : undefined}
          aria-label={filtersOpen ? (ar ? "تصفية النتائج" : "Filter results") : undefined}
          className={cn(
            filtersOpen
              ? "fixed inset-x-0 bottom-0 z-modal block max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-lg bg-canvas px-sm pb-[max(1rem,env(safe-area-inset-bottom))] pt-xs shadow-lg tablet:inset-x-auto tablet:end-0 tablet:start-0 tablet:mx-auto tablet:max-w-xl"
              : "hidden",
            contained
              ? "wide:static wide:block wide:h-full wide:min-h-0 wide:max-h-none wide:overflow-hidden wide:rounded-none wide:bg-transparent wide:p-0 wide:shadow-none"
              : "wide:sticky wide:top-md wide:block wide:max-h-[calc(100dvh-2rem)] wide:self-start wide:overflow-y-auto wide:rounded-none wide:bg-transparent wide:p-0 wide:shadow-none",
          )}
        >
          <div className="relative flex h-10 items-center justify-center wide:hidden">
            <span className="h-1 w-10 rounded-pill bg-fg-muted/50" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              aria-label={ar ? "إغلاق الفلاتر" : "Close filters"}
              className="absolute end-0 top-0 grid h-10 w-10 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <XIcon size={18} />
            </button>
          </div>
          <OpportunityFilters
            locale={locale}
            filters={filters}
            tradeOptions={tradeOptions}
            governorates={governorates}
            resultCount={opportunities.length}
            previewBudgetCeiling={preview?.budgetCeiling}
            onFiltersChange={onFiltersChange}
            onApply={() => setFiltersOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        active ? "bg-primary text-primary-foreground" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function GridViewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><rect x="14" y="14" width="6.5" height="6.5" rx="1" />
    </svg>
  );
}

function ListViewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.5" />
    </svg>
  );
}

function formatCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(value);
}
