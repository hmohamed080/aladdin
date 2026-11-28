"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Select } from "@/components/ui/controls";

type Props = {
  id: string;
  name: string;
  value: string | null;
  locale: "ar" | "en";
  label: string;
  placeholder: string;
  clearLabel: string;
  todayLabel: string;
  /** Earliest selectable year (the database floor is 1900). */
  minYear?: number;
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** A calendar popover with month and year selectors. Holds its value in a hidden input so the settings save bar can submit it. */
export function DatePicker({ id, name, value, locale, label, placeholder, clearLabel, todayLabel, minYear = 1900 }: Props) {
  const tag = locale === "ar" ? "ar-u-nu-latn" : "en";
  const today = useMemo(() => new Date(), []);
  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const [selected, setSelected] = useState(parsed);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = parsed ? new Date(`${parsed}T00:00:00`) : new Date(today.getFullYear() - 25, 0, 1);
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const root = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element;
      // The month/year menus render in a floating layer outside this popover; picking from one is not an outside click.
      if (!root.current?.contains(target) && !target.closest('[role="listbox"], [role="option"]')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(tag, { month: "long" }).format(new Date(2024, m, 1))),
    [tag],
  );
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(tag, { weekday: "narrow" });
    // 2023-01-01 is a Sunday; the grid starts on Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [tag]);
  const years = useMemo(() => {
    const max = today.getFullYear();
    return Array.from({ length: max - minYear + 1 }, (_, i) => max - i);
  }, [today, minYear]);

  const commit = (next: string) => {
    setSelected(next);
    // The hidden input has no user events of its own; announce the change so the page-level save bar notices it.
    requestAnimationFrame(() => hidden.current?.dispatchEvent(new Event("input", { bubbles: true })));
  };

  const first = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = Array.from({ length: first + daysInMonth }, (_, i) => (i < first ? null : i - first + 1));
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return d.getFullYear() < minYear || d > today ? v : { y: d.getFullYear(), m: d.getMonth() };
    });

  const display = selected
    ? new Intl.DateTimeFormat(tag, { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${selected}T00:00:00`))
    : "";

  return (
    <div className="dp" ref={root}>
      <input ref={hidden} type="hidden" name={name} value={selected} />
      <button
        type="button"
        id={id}
        className="dp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {display || <span className="dp-placeholder">{placeholder}</span>}
      </button>
      {open ? (
        <div id={dialogId} role="dialog" aria-label={label} className="dp-pop">
          <div className="dp-head">
            <button type="button" className="dp-nav dp-prev" aria-label={locale === "ar" ? "الشهر السابق" : "Previous month"} onClick={() => shift(-1)}><ChevronLeftIcon size={16} /></button>
            <Select size="compact" aria-label={locale === "ar" ? "الشهر" : "Month"} value={view.m} onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}>
              {months.map((name, m) => <option key={m} value={m}>{name}</option>)}
            </Select>
            <Select size="compact" aria-label={locale === "ar" ? "السنة" : "Year"} value={view.y} onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <button type="button" className="dp-nav dp-next" aria-label={locale === "ar" ? "الشهر التالي" : "Next month"} onClick={() => shift(1)}><ChevronLeftIcon size={16} /></button>
          </div>
          <div className="dp-grid" role="grid">
            {weekdays.map((w, i) => <span key={i} className="dp-dow" role="columnheader">{w}</span>)}
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const value = iso(view.y, view.m, day);
              const future = value > todayIso;
              return (
                <button
                  key={i}
                  type="button"
                  className="dp-day"
                  data-today={value === todayIso || undefined}
                  aria-pressed={value === selected}
                  disabled={future}
                  onClick={() => { commit(value); setOpen(false); }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="dp-foot">
            <button type="button" onClick={() => { commit(""); setOpen(false); }}>{clearLabel}</button>
            <button type="button" onClick={() => { commit(todayIso); setView({ y: today.getFullYear(), m: today.getMonth() }); setOpen(false); }}>{todayLabel}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
