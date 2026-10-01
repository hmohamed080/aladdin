"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/controls";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import {
  pick,
  TRADE_OPTIONS,
  type DurationKey,
  type TradeKey,
} from "./preview-data";

export function OpportunityFilters({
  locale,
  selectedTrades,
  maxBudget,
  duration,
  radiusKm,
  resultCount,
  onTradeToggle,
  onBudgetChange,
  onDurationChange,
  onRadiusChange,
  onApply,
}: {
  locale: Locale;
  selectedTrades: ReadonlySet<TradeKey>;
  maxBudget: number;
  duration: DurationKey;
  radiusKm: number;
  resultCount: number;
  onTradeToggle: (trade: TradeKey) => void;
  onBudgetChange: (value: number) => void;
  onDurationChange: (value: DurationKey) => void;
  onRadiusChange: (value: number) => void;
  onApply: () => void;
}) {
  const ar = locale === "ar";
  const budgetProgress = ((maxBudget - 2000) / (12000 - 2000)) * 100;

  return (
    <aside aria-label={ar ? "تصفية النتائج" : "Filter results"} className="overflow-hidden rounded-md border bg-surface shadow-card wide:h-full wide:overflow-y-auto">
      <div className="flex items-center justify-between border-b px-md py-3">
        <h2 className="text-body-lg font-semibold text-fg">{ar ? "تصفية النتائج" : "Filter results"}</h2>
        <button
          type="button"
          onClick={() => {
            for (const option of TRADE_OPTIONS) if (selectedTrades.has(option.key)) onTradeToggle(option.key);
            onBudgetChange(12000);
            onDurationChange("all");
            onRadiusChange(15);
          }}
          className="text-label font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {ar ? "مسح الكل" : "Clear all"}
        </button>
      </div>

      <FilterSection title={ar ? "موقع العمل" : "Work location"}>
        <RealMap locale={locale} />
        <FilterMenuSelect
          className="mt-sm"
          label={ar ? "نطاق المسافة" : "Distance radius"}
          value={String(radiusKm)}
          options={[
            { value: "5", label: ar ? "داخل ٥ كم" : "Within 5 km" },
            { value: "10", label: ar ? "داخل ١٠ كم" : "Within 10 km" },
            { value: "15", label: ar ? "داخل ١٥ كم" : "Within 15 km" },
          ]}
          onChange={(value) => onRadiusChange(Number(value))}
        />
      </FilterSection>

      <FilterSection title={ar ? "نوع العمل" : "Work type"}>
        <div className="grid gap-2 wide:gap-1">
          {TRADE_OPTIONS.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-center gap-2.5 text-body text-fg-secondary">
              <input
                type="checkbox"
                checked={selectedTrades.has(option.key)}
                onChange={() => onTradeToggle(option.key)}
                className="h-4 w-4 rounded-xs border-strong accent-accent-solid focus-visible:ring-2 focus-visible:ring-focus"
              />
              <span>{pick(locale, option.label)}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection title={ar ? "ميزانية العمل" : "Job budget"}>
        <div className="mb-2 flex items-center justify-between gap-sm text-label text-fg-secondary">
          <span>{ar ? "من ٠" : "From 0"}</span>
          <span className="font-mono text-fg">{formatBudget(maxBudget, locale)}</span>
        </div>
        <input
          type="range"
          min={2000}
          max={12000}
          step={500}
          value={maxBudget}
          onChange={(event) => onBudgetChange(Number(event.target.value))}
          aria-label={ar ? "الحد الأقصى للميزانية" : "Maximum budget"}
          dir={ar ? "rtl" : "ltr"}
          style={{ "--range-progress": `${budgetProgress}%` } as CSSProperties}
          className="installer-budget-range w-full cursor-pointer rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </FilterSection>

      <FilterSection title={ar ? "مدة التنفيذ" : "Duration"}>
        <FilterMenuSelect
          label={ar ? "مدة التنفيذ" : "Duration"}
          value={duration}
          options={[
            { value: "all", label: ar ? "كل المدد" : "All durations" },
            { value: "short", label: ar ? "يومان أو أقل" : "2 days or less" },
            { value: "medium", label: ar ? "من ٣ إلى ٥ أيام" : "3 to 5 days" },
          ]}
          onChange={(value) => onDurationChange(value as DurationKey)}
        />
      </FilterSection>

      <div className="flex justify-center p-md wide:p-sm wide:pe-0">
        <Button className="w-full max-w-56 justify-center gap-2" onClick={onApply}>
          {ar ? "تطبيق الفلاتر" : "Apply filters"}
          <span className="rounded-pill bg-primary-foreground/15 px-2 py-0.5 text-label tabular-nums">{resultCount}</span>
        </Button>
      </div>
    </aside>
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
          className="absolute start-0 top-full z-popover mt-1 w-full overflow-hidden rounded-md border border-strong bg-surface p-xs shadow-lg"
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

function formatBudget(value: number, locale: Locale) {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 0 }).format(value);
  return locale === "ar" ? `${amount} جنيه` : `EGP ${amount}`;
}
