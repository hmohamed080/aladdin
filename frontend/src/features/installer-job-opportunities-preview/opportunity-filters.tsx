"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/controls";
import { ChevronDownIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
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
        <label className="relative mt-sm block">
          <span className="sr-only">{ar ? "نطاق المسافة" : "Distance radius"}</span>
          <select
            value={radiusKm}
            onChange={(event) => onRadiusChange(Number(event.target.value))}
            className="h-10 w-full appearance-none rounded-sm border bg-field px-3 pe-9 text-body text-field-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value={5}>{ar ? "داخل ٥ كم" : "Within 5 km"}</option>
            <option value={10}>{ar ? "داخل ١٠ كم" : "Within 10 km"}</option>
            <option value={15}>{ar ? "داخل ١٥ كم" : "Within 15 km"}</option>
          </select>
          <ChevronDownIcon size={15} className="pointer-events-none absolute end-3 top-3 text-fg-muted" />
        </label>
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
        <label className="relative block">
          <span className="sr-only">{ar ? "مدة التنفيذ" : "Duration"}</span>
          <select
            value={duration}
            onChange={(event) => onDurationChange(event.target.value as DurationKey)}
            className="h-10 w-full appearance-none rounded-sm border bg-field px-3 pe-9 text-body text-field-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="all">{ar ? "كل المدد" : "All durations"}</option>
            <option value="short">{ar ? "يومان أو أقل" : "2 days or less"}</option>
            <option value="medium">{ar ? "من ٣ إلى ٥ أيام" : "3 to 5 days"}</option>
          </select>
          <ChevronDownIcon size={15} className="pointer-events-none absolute end-3 top-3 text-fg-muted" />
        </label>
      </FilterSection>

      <div className="p-md pt-0 wide:p-sm wide:pt-0">
        <Button className="w-full gap-2" onClick={onApply}>
          {ar ? "تطبيق الفلاتر" : "Apply filters"}
          <span className="rounded-pill bg-primary-foreground/15 px-2 py-0.5 text-label tabular-nums">{resultCount}</span>
        </Button>
      </div>
    </aside>
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
    <div className="relative h-36 overflow-hidden rounded-sm border bg-surface-2 wide:h-28">
      <iframe
        title={ar ? "خريطة تفاعلية للقاهرة الجديدة" : "Interactive map of New Cairo"}
        src="https://www.openstreetmap.org/export/embed.html?bbox=31.425%2C29.965%2C31.555%2C30.075&layer=mapnik&marker=30.0131%2C31.4913"
        loading="lazy"
        referrerPolicy="no-referrer"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}

function formatBudget(value: number, locale: Locale) {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 0 }).format(value);
  return locale === "ar" ? `${amount} جنيه` : `EGP ${amount}`;
}
