"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/controls";
import { FilterIcon, HeartFilledIcon, SearchIcon } from "@/components/ui/icons";
import { StatePanel } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/locales";
import { useI18n } from "@/lib/i18n/context";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { cn } from "@/lib/ui/cn";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { OpportunityCard } from "./opportunity-card";
import { OpportunityFilters } from "./opportunity-filters";
import {
  PREVIEW_OPPORTUNITIES,
  filterPreviewOpportunities,
  type DurationKey,
  type SortKey,
  type TradeKey,
} from "./preview-data";

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; ar: string; en: string }> = [
  { value: "newest", ar: "الأحدث", en: "Newest" },
  { value: "nearest", ar: "الأقرب لي", en: "Nearest" },
  { value: "highest", ar: "الأعلى أجرًا", en: "Highest pay" },
  { value: "demanded", ar: "الأكثر طلبًا", en: "Most requested" },
];

export function InstallerJobOpportunitiesPreview({
  theme,
  sidebarMode,
}: {
  theme: "light" | "dark";
  sidebarMode: SidebarMode;
}) {
  const { locale, dir } = useI18n();
  const ar = locale === "ar";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [savedOnly, setSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(PREVIEW_OPPORTUNITIES.filter((opportunity) => opportunity.initiallySaved).map((opportunity) => opportunity.id)),
  );
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const [trades, setTrades] = useState<Set<TradeKey>>(() => new Set());
  const [maxBudget, setMaxBudget] = useState(12000);
  const [duration, setDuration] = useState<DurationKey>("all");
  const [radiusKm, setRadiusKm] = useState(15);
  const [expanded, setExpanded] = useState(false);

  const opportunities = useMemo(
    () => filterPreviewOpportunities(PREVIEW_OPPORTUNITIES, { sort, trades, maxBudget, duration, radiusKm, savedOnly, savedIds }),
    [duration, maxBudget, radiusKm, savedIds, savedOnly, sort, trades],
  );
  const visibleOpportunities = expanded ? opportunities : opportunities.slice(0, 6);

  const toggleTrade = (trade: TradeKey) => {
    setTrades((current) => {
      const next = new Set(current);
      if (next.has(trade)) next.delete(trade);
      else next.add(trade);
      return next;
    });
    setExpanded(false);
  };

  const toggleSaved = (id: string) => {
    setSavedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div data-installer-opportunities-root="" dir={dir} className="installer-surface flex min-h-dvh bg-workspace wide:fixed wide:inset-0 wide:h-dvh wide:overflow-hidden">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="jobs"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-sm pb-md pe-3 ps-3 pt-sm desktop:pe-4 desktop:ps-4">
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />

        <main id="opportunities" className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-md px-md pb-md pt-xs tablet:px-lg tablet:pb-lg wide:overflow-hidden">
          <header className="flex shrink-0 flex-col gap-sm tablet:flex-row tablet:items-end tablet:justify-between">
            <div>
              <h1 className="text-headline text-fg">{ar ? "فرص الشغل" : "Job opportunities"}</h1>
              <p className="mt-1 max-w-2xl text-body text-fg-secondary">
                {ar ? "اكتشف فرص الشغل المناسبة لمهاراتك وقدّم عليها بسهولة" : "Discover work opportunities that fit your skills and apply with ease."}
              </p>
            </div>
            <Button
              variant={savedOnly ? "primary" : "outline"}
              className="gap-2 self-start tablet:self-auto"
              aria-pressed={savedOnly}
              onClick={() => {
                setSavedOnly((current) => !current);
                setExpanded(false);
              }}
            >
              <HeartFilledIcon size={17} className="text-danger" />
              {ar ? "فرص محفوظة" : "Saved opportunities"}
              <span className="tabular-nums">{savedIds.size}</span>
            </Button>
          </header>

          <div className="flex shrink-0 flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-between">
            <div role="group" aria-label={ar ? "ترتيب الفرص" : "Sort opportunities"} className="flex min-w-0 overflow-x-auto rounded-sm border bg-surface p-1 shadow-card">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={sort === option.value}
                  onClick={() => setSort(option.value)}
                  className={cn(
                    "min-w-max rounded-xs px-3 py-2 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    sort === option.value ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {ar ? option.ar : option.en}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-sm">
              <Button variant="outline" size="sm" className="gap-2 wide:hidden" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen}>
                <FilterIcon size={16} />
                {ar ? "الفلاتر" : "Filters"}
              </Button>
              <div className="inline-flex rounded-sm border bg-surface p-1 shadow-card" role="group" aria-label={ar ? "طريقة عرض الفرص" : "Opportunity view"}>
                <ViewButton active={view === "grid"} label={ar ? "عرض شبكي" : "Grid view"} onClick={() => setView("grid")}><GridViewIcon /></ViewButton>
                <ViewButton active={view === "list"} label={ar ? "عرض قائمة" : "List view"} onClick={() => setView("list")}><ListViewIcon /></ViewButton>
              </div>
            </div>
          </div>

          <div dir="ltr" className="grid min-h-0 flex-1 items-start gap-md wide:grid-cols-[minmax(0,1fr)_18rem] wide:overflow-hidden">
            <section dir={dir} aria-live="polite" className="min-w-0 wide:h-full wide:min-h-0 wide:overflow-y-auto wide:pe-sm">
              <div className="mb-sm flex items-center justify-between gap-sm">
                <p className="text-label text-fg-secondary">
                  {ar ? `${formatCount(opportunities.length, locale)} فرصة متاحة` : `${formatCount(opportunities.length, locale)} opportunities available`}
                </p>
                {savedOnly ? <span className="text-label font-medium text-accent">{ar ? "المحفوظة فقط" : "Saved only"}</span> : null}
              </div>

              {visibleOpportunities.length === 0 ? (
                <StatePanel
                  icon={<SearchIcon size={20} />}
                  title={ar ? "لا توجد فرص بهذه الفلاتر" : "No opportunities match these filters"}
                  body={ar ? "جرّب توسيع نطاق الموقع أو تعديل نوع العمل والميزانية." : "Try widening the location radius or adjusting work type and budget."}
                />
              ) : (
                <ul className={cn("grid gap-md", view === "grid" ? "tablet:grid-cols-2 wide:grid-cols-3" : "grid-cols-1")}>
                  {visibleOpportunities.map((opportunity) => (
                    <li key={opportunity.id} className="min-w-0">
                      <OpportunityCard
                        opportunity={opportunity}
                        locale={locale}
                        saved={savedIds.has(opportunity.id)}
                        applied={appliedIds.has(opportunity.id)}
                        view={view}
                        onToggleSaved={() => toggleSaved(opportunity.id)}
                        onApply={() => setAppliedIds((current) => new Set(current).add(opportunity.id))}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {!expanded && opportunities.length > 6 ? (
                <div className="mt-lg flex justify-center">
                  <Button variant="outline" onClick={() => setExpanded(true)}>
                    {ar ? "عرض المزيد من الفرص" : "View more opportunities"}
                  </Button>
                </div>
              ) : null}
            </section>

            <div dir={dir} className={cn(filtersOpen ? "block" : "hidden", "wide:block wide:h-full wide:min-h-0 wide:overflow-hidden")}>
              <OpportunityFilters
                locale={locale}
                selectedTrades={trades}
                maxBudget={maxBudget}
                duration={duration}
                radiusKm={radiusKm}
                resultCount={opportunities.length}
                onTradeToggle={toggleTrade}
                onBudgetChange={(value) => { setMaxBudget(value); setExpanded(false); }}
                onDurationChange={(value) => { setDuration(value); setExpanded(false); }}
                onRadiusChange={(value) => { setRadiusKm(value); setExpanded(false); }}
                onApply={() => setFiltersOpen(false)}
              />
            </div>
          </div>
        </main>
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
