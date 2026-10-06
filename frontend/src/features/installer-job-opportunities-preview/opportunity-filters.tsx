"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button, Input } from "@/components/ui/controls";
import { ChevronDownIcon, SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { formatEgp } from "@/lib/ui/egp-format";
import {
  DEFAULT_BOARD_FILTERS,
  type AppliedFilter,
  type BoardFilters,
  type DurationFilter,
  type TradeOption,
} from "./view-model";

/**
 * The filter rail / bottom sheet — one panel for the preview and for production.
 *
 * Production sections: Search, Location (governorate), Work type, Budget
 * (minimum and maximum, both optional and unbounded), Duration, Applied.
 * Preview-only sections (their data does not exist in production): the map, the
 * distance radius and the budget slider with its fixture ceiling.
 *
 * Every change is reported through `onFiltersChange`; this component keeps no
 * authoritative state. Text and amount inputs are uncontrolled and committed on
 * blur / Enter, so typing does not navigate on every keystroke.
 */
export function OpportunityFilters({
  locale,
  filters,
  tradeOptions,
  governorates,
  resultCount,
  previewBudgetCeiling,
  onFiltersChange,
  onApply,
}: {
  locale: Locale;
  filters: BoardFilters;
  tradeOptions: readonly TradeOption[];
  governorates: readonly string[];
  resultCount: number;
  /** Present only in the preview, which keeps its slider (and map and radius). */
  previewBudgetCeiling?: number;
  onFiltersChange: (next: BoardFilters) => void;
  onApply: () => void;
}) {
  const ar = locale === "ar";
  const { t } = useI18n();
  const preview = previewBudgetCeiling !== undefined;
  const set = (patch: Partial<BoardFilters>) => onFiltersChange({ ...filters, ...patch });
  const toggleTrade = (key: string) =>
    set({ tradeKeys: filters.tradeKeys.includes(key) ? filters.tradeKeys.filter((k) => k !== key) : [...filters.tradeKeys, key] });

  const ceiling = previewBudgetCeiling ?? 0;
  const sliderValue = filters.maxAmount ?? ceiling;
  const budgetProgress = preview ? ((sliderValue - 2000) / (ceiling - 2000)) * 100 : 0;

  return (
    <aside aria-label={ar ? "تصفية النتائج" : "Filter results"} className="overflow-hidden rounded-md border bg-surface shadow-card wide:h-full wide:overflow-y-auto">
      <div className="flex items-center justify-between border-b px-md py-3">
        <h2 className="text-body-lg font-semibold text-fg">{ar ? "تصفية النتائج" : "Filter results"}</h2>
        <button
          type="button"
          onClick={() => onFiltersChange(DEFAULT_BOARD_FILTERS)}
          className="text-label font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {ar ? "مسح الكل" : "Clear all"}
        </button>
      </div>

      {preview ? null : (
        <FilterSection title={ar ? "بحث" : "Search"}>
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              set({ q: new FormData(event.currentTarget).get("q")?.toString().trim() ?? "" });
            }}
            className="relative"
          >
            <SearchIcon size={15} className="pointer-events-none absolute start-sm top-1/2 -translate-y-1/2 text-fg-muted" />
            <Input
              key={filters.q}
              type="search"
              name="q"
              aria-label={t("jobs.opportunities.searchPlaceholder")}
              placeholder={t("jobs.opportunities.searchPlaceholder")}
              defaultValue={filters.q}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next !== filters.q) set({ q: next });
              }}
              className="min-h-10 pe-sm ps-8 text-label"
            />
          </form>
        </FilterSection>
      )}

      {preview ? (
        <FilterSection title={ar ? "موقع العمل" : "Work location"}>
          <RealMap locale={locale} />
          <FilterMenuSelect
            className="mt-sm"
            label={ar ? "نطاق المسافة" : "Distance radius"}
            value={String(filters.radiusKm)}
            options={[
              { value: "5", label: ar ? "داخل ٥ كم" : "Within 5 km" },
              { value: "10", label: ar ? "داخل ١٠ كم" : "Within 10 km" },
              { value: "15", label: ar ? "داخل ١٥ كم" : "Within 15 km" },
            ]}
            onChange={(value) => set({ radiusKm: Number(value) })}
          />
        </FilterSection>
      ) : (
        <FilterSection title={ar ? "الموقع" : "Location"}>
          <FilterMenuSelect
            label={ar ? "المحافظة" : "Governorate"}
            value={filters.governorate}
            options={[
              { value: "", label: t("jobs.opportunities.allLocations") },
              // Free text the posters wrote, so the label IS the value.
              ...governorates.map((g) => ({ value: g, label: g })),
            ]}
            onChange={(value) => set({ governorate: value })}
          />
        </FilterSection>
      )}

      {tradeOptions.length > 0 ? (
        <FilterSection title={ar ? "نوع العمل" : "Work type"}>
          <div className="grid max-h-72 gap-2 overflow-y-auto wide:gap-1">
            {tradeOptions.map((option) => (
              <label key={option.key} className="flex cursor-pointer items-center gap-2.5 text-body text-fg-secondary">
                <input
                  type="checkbox"
                  checked={filters.tradeKeys.includes(option.key)}
                  onChange={() => toggleTrade(option.key)}
                  className="h-4 w-4 rounded-xs border-strong accent-accent-solid focus-visible:ring-2 focus-visible:ring-focus"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {preview ? null : <p className="mt-sm text-caption text-fg-muted">{t("jobs.opportunities.offTradeNote")}</p>}
        </FilterSection>
      ) : null}

      <FilterSection title={ar ? "ميزانية العمل" : "Job budget"}>
        {preview ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-sm text-label text-fg-secondary">
              <span>{ar ? "من ٠" : "From 0"}</span>
              <span className="font-mono text-fg">{formatEgp(sliderValue, locale)}</span>
            </div>
            <input
              type="range"
              min={2000}
              max={ceiling}
              step={500}
              value={sliderValue}
              onChange={(event) => {
                const next = Number(event.target.value);
                set({ maxAmount: next >= ceiling ? null : next });
              }}
              aria-label={ar ? "الحد الأقصى للميزانية" : "Maximum budget"}
              dir={ar ? "rtl" : "ltr"}
              style={{ "--range-progress": `${budgetProgress}%` } as CSSProperties}
              className="installer-budget-range w-full cursor-pointer rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </>
        ) : (
          <BudgetRange locale={locale} min={filters.minAmount} max={filters.maxAmount} onChange={(min, max) => set({ minAmount: min, maxAmount: max })} />
        )}
      </FilterSection>

      <FilterSection title={ar ? "مدة التنفيذ" : "Duration"}>
        <FilterMenuSelect
          label={ar ? "مدة التنفيذ" : "Duration"}
          value={filters.duration}
          options={[
            { value: "all", label: ar ? "كل المدد" : "All durations" },
            { value: "short", label: ar ? "يومان أو أقل" : "2 days or less" },
            { value: "medium", label: ar ? "من ٣ إلى ٥ أيام" : "3 to 5 days" },
            { value: "long", label: ar ? "٦ أيام أو أكثر" : "6 days or more" },
          ]}
          onChange={(value) => set({ duration: value as DurationFilter })}
        />
      </FilterSection>

      {preview ? null : (
        <FilterSection title={t("jobs.applications.title")}>
          <FilterMenuSelect
            label={t("jobs.applications.title")}
            value={filters.applied}
            options={[
              { value: "", label: t("jobs.opportunities.allApplications") },
              { value: "no", label: t("jobs.opportunities.notApplied") },
              { value: "yes", label: t("jobs.opportunities.appliedOnly") },
            ]}
            onChange={(value) => set({ applied: value as AppliedFilter })}
          />
        </FilterSection>
      )}

      <div className="flex justify-center p-md wide:p-sm wide:pe-0">
        <Button className="w-full max-w-56 justify-center gap-2" onClick={onApply}>
          {ar ? "تطبيق الفلاتر" : "Apply filters"}
          <span className="rounded-pill bg-primary-foreground/15 px-2 py-0.5 text-label tabular-nums">{resultCount}</span>
        </Button>
      </div>
    </aside>
  );
}

type AmountParse = { ok: true; value: number | null } | { ok: false };

function parseAmount(text: string): AmountParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? { ok: true, value } : { ok: false };
}

/**
 * Minimum and maximum offered amount, both optional. No ceiling is invented: the
 * bounds are whatever the viewer types, applied to the real `offered_amount`.
 */
function BudgetRange({
  locale,
  min,
  max,
  onChange,
}: {
  locale: Locale;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const ar = locale === "ar";
  const [error, setError] = useState(false);
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const lo = parseAmount(minRef.current?.value ?? "");
    const hi = parseAmount(maxRef.current?.value ?? "");
    if (!lo.ok || !hi.ok || (lo.value !== null && hi.value !== null && lo.value > hi.value)) {
      setError(true);
      return;
    }
    setError(false);
    if (lo.value !== min || hi.value !== max) onChange(lo.value, hi.value);
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-sm">
        <label className="grid gap-1 text-label text-fg-secondary">
          {ar ? "الحد الأدنى (جنيه)" : "Minimum (EGP)"}
          <Input
            key={`min-${min ?? ""}`}
            ref={minRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={min ?? ""}
            onBlur={commit}
            onKeyDown={onKey}
            aria-invalid={error || undefined}
            className="min-h-10 text-label"
          />
        </label>
        <label className="grid gap-1 text-label text-fg-secondary">
          {ar ? "الحد الأقصى (جنيه)" : "Maximum (EGP)"}
          <Input
            key={`max-${max ?? ""}`}
            ref={maxRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={max ?? ""}
            onBlur={commit}
            onKeyDown={onKey}
            aria-invalid={error || undefined}
            className="min-h-10 text-label"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="mt-xs text-caption text-danger">
          {ar ? "أدخل أرقامًا صحيحة، والحد الأدنى لا يتجاوز الأقصى." : "Enter valid amounts; the minimum cannot exceed the maximum."}
        </p>
      ) : null}
    </div>
  );
}

function FilterMenuSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex min-h-10 w-full items-center justify-between gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-body text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDownIcon size={15} className={cn("shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute start-0 top-full z-popover mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-strong bg-surface p-xs shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-9 w-full items-center rounded-sm px-sm text-start text-label text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                option.value === value && "bg-info/10 font-semibold text-info",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b p-md wide:p-sm">
      <h3 className="mb-sm text-body font-semibold text-fg wide:mb-xs">{title}</h3>
      {children}
    </section>
  );
}

/**
 * PREVIEW ONLY. A fixed New Cairo marker: it has no relationship to any job and
 * production never renders it.
 */
function RealMap({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <div>
      <div className="relative h-36 overflow-hidden rounded-sm border bg-surface-2 wide:h-28">
        <iframe
          title={ar ? "خريطة تفاعلية للقاهرة الجديدة" : "Interactive map of New Cairo"}
          src="https://www.openstreetmap.org/export/embed.html?bbox=31.425%2C29.965%2C31.555%2C30.075&layer=mapnik&marker=30.0131%2C31.4913"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-x-0 top-0 h-[calc(100%+6rem)] w-full border-0"
        />
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-end text-[10px] text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}
