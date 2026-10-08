"use client";

import { useId, useState } from "react";
import { Button, Input } from "@/components/ui/controls";
import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { useDialogFocus } from "@/lib/ui/use-dialog-focus";

/**
 * A date-range picker shared by the installer work and reviews surfaces. It owns
 * no data: the caller supplies and receives ISO `YYYY-MM-DD` bounds.
 *
 * The calendar opens on the month of the current selection, else on `initialMonth`
 * (`YYYY-MM`), else on the current month — never on a hard-coded date.
 */
export type WorkDateRange = { from: string; to: string };

function startMonth(value: WorkDateRange, initialMonth?: string): Date {
  const source = value.from || value.to || (initialMonth ? `${initialMonth}-01` : "");
  const parsed = source ? new Date(`${source.slice(0, 7)}-01T00:00:00Z`) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function DateRangeFilter({ locale, value, onChange, compact = false, placeholder, initialMonth }: { locale: Locale; value: WorkDateRange; onChange: (value: WorkDateRange) => void; compact?: boolean; placeholder?: string; initialMonth?: string }) {
  const ar = locale === "ar";
  const [open, setOpen] = useState(false);
  const label = value.from || value.to
    ? [value.from, value.to].filter(Boolean).map((date) => new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))).join(" – ")
    : (placeholder ?? (ar ? "اختر التاريخ" : "Select date"));

  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={cn("flex items-center justify-between gap-sm rounded-sm border border-strong bg-surface px-sm text-start text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", compact ? "h-10 w-full min-w-0 shrink-0 text-label tablet:w-44" : "min-h-11 w-full text-body")}>
        <span className="flex min-w-0 items-center gap-sm leading-normal"><CalendarIcon size={17} className="shrink-0 text-fg-muted" /><span className="truncate">{label}</span></span>
        <ChevronDownIcon size={15} className="shrink-0 text-fg-muted" />
      </button>
      {open ? <DateRangeDialog locale={locale} value={value} initialMonth={initialMonth} onClose={() => setOpen(false)} onApply={(next) => { onChange(next); setOpen(false); }} /> : null}
    </>
  );
}

function DateRangeDialog({ locale, value, initialMonth, onClose, onApply }: { locale: Locale; value: WorkDateRange; initialMonth?: string; onClose: () => void; onApply: (value: WorkDateRange) => void }) {
  const ar = locale === "ar";
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [draft, setDraft] = useState(value);
  const [firstMonth, setFirstMonth] = useState(() => startMonth(value, initialMonth));
  const secondMonth = addUtcMonths(firstMonth, 1);
  const presets = getDatePresets(ar ? "ar" : "en");

  const selectDate = (iso: string) => {
    setDraft((current) => {
      if (!current.from || current.to) return { from: iso, to: "" };
      return iso < current.from ? { from: iso, to: current.from } : { from: current.from, to: iso };
    });
  };

  return (
    <div className="fixed inset-0 z-popover flex items-center justify-center bg-brand-basalt/40 p-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-md border bg-surface shadow-lg">
        <div className="flex items-center justify-between gap-md border-b px-lg py-md">
          <h3 id={titleId} className="text-title text-fg">{ar ? "اختر نطاق التاريخ" : "Select date range"}</h3>
          <button type="button" onClick={onClose} aria-label={ar ? "إغلاق" : "Close"} className="grid h-9 w-9 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><XIcon size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto desktop:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col border-b p-md desktop:border-b-0 desktop:border-e">
            {presets.map((preset) => (
              <button key={preset.label} type="button" onClick={() => setDraft(preset.value)} className="min-h-10 rounded-sm px-sm text-start text-body text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{preset.label}</button>
            ))}
          </div>
          <CalendarMonth locale={locale} month={firstMonth} range={draft} onSelect={selectDate} onPrevious={() => setFirstMonth((current) => addUtcMonths(current, -1))} />
          <CalendarMonth locale={locale} month={secondMonth} range={draft} onSelect={selectDate} onNext={() => setFirstMonth((current) => addUtcMonths(current, 1))} />
        </div>

        <div className="flex flex-col gap-md border-t px-lg py-md tablet:flex-row tablet:items-center tablet:justify-between">
          <div className="flex items-center gap-sm" dir="ltr">
            <Input type="date" aria-label={ar ? "من تاريخ" : "From date"} value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="min-h-9 py-1.5 text-label" />
            <span className="text-fg-muted">–</span>
            <Input type="date" aria-label={ar ? "إلى تاريخ" : "To date"} value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="min-h-9 py-1.5 text-label" />
          </div>
          <div className="flex justify-end gap-sm">
            <Button variant="outline" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => onApply(draft)}>{ar ? "تطبيق" : "Apply"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarMonth({ locale, month, range, onSelect, onPrevious, onNext }: { locale: Locale; month: Date; range: WorkDateRange; onSelect: (iso: string) => void; onPrevious?: () => void; onNext?: () => void }) {
  const ar = locale === "ar";
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstOffset = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = [...Array.from({ length: firstOffset }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const weekday = ar ? ["اث", "ث", "أر", "خ", "ج", "س", "ح"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <section className="border-b p-md last:border-b-0 desktop:border-b-0 desktop:border-e desktop:last:border-e-0">
      <div className="flex min-h-9 items-center justify-between gap-sm">
        {onPrevious ? <button type="button" aria-label={ar ? "الشهر السابق" : "Previous month"} onClick={onPrevious} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronLeftIcon size={16} /></button> : <span className="h-8 w-8" />}
        <h4 className="text-body font-semibold text-fg">{new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}</h4>
        {onNext ? <button type="button" aria-label={ar ? "الشهر التالي" : "Next month"} onClick={onNext} className="grid h-8 w-8 place-items-center rounded-sm text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><ChevronRightIcon size={16} /></button> : <span className="h-8 w-8" />}
      </div>
      <div className="mt-sm grid grid-cols-7 gap-xs text-center">
        {weekday.map((day) => <span key={day} className="py-1 text-label font-medium text-fg-muted">{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const edge = iso === range.from || iso === range.to;
          const within = Boolean(range.from && range.to && iso > range.from && iso < range.to);
          return (
            <button key={iso} type="button" aria-label={iso} aria-pressed={edge} onClick={() => onSelect(iso)} className={cn("grid aspect-square min-h-8 place-items-center rounded-sm text-label text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", within && "bg-info/10", edge && "bg-info text-white hover:bg-info")}>
              {formatNumber(day, locale)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function getDatePresets(locale: "ar" | "en"): readonly { label: string; value: WorkDateRange }[] {
  const anchor = new Date();
  const day = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const iso = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
  const monthStart = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  const monthEnd = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0);
  const yearStart = Date.UTC(anchor.getUTCFullYear(), 0, 1);
  const yearEnd = Date.UTC(anchor.getUTCFullYear(), 11, 31);
  const weekday = (anchor.getUTCDay() + 6) % 7;
  const labels = locale === "ar"
    ? ["اليوم", "أمس", "هذا الأسبوع", "الأسبوع الماضي", "هذا الشهر", "الشهر الماضي", "هذا العام", "العام الماضي", "كل الوقت"]
    : ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "Last year", "All time"];
  return [
    { label: labels[0]!, value: { from: iso(day), to: iso(day) } },
    { label: labels[1]!, value: { from: iso(day - 86400000), to: iso(day - 86400000) } },
    { label: labels[2]!, value: { from: iso(day - weekday * 86400000), to: iso(day + (6 - weekday) * 86400000) } },
    { label: labels[3]!, value: { from: iso(day - (weekday + 7) * 86400000), to: iso(day - (weekday + 1) * 86400000) } },
    { label: labels[4]!, value: { from: iso(monthStart), to: iso(monthEnd) } },
    { label: labels[5]!, value: { from: iso(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)), to: iso(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0)) } },
    { label: labels[6]!, value: { from: iso(yearStart), to: iso(yearEnd) } },
    { label: labels[7]!, value: { from: iso(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1)), to: iso(Date.UTC(anchor.getUTCFullYear() - 1, 11, 31)) } },
    { label: labels[8]!, value: { from: "", to: "" } },
  ];
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG", { maximumFractionDigits: 1 }).format(value);
}
