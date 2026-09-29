"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CalendarIcon } from "@/components/ui/icons";
import { classifyAdminDate, formatAdminDateInput, maskAdminDate, parseAdminDate } from "@/features/admin-preview/date-input";

/**
 * The ONE Admin date entry control. It always reads and writes DD/MM/YYYY —
 * unlike a native `<input type="date">`, whose order follows the browser's
 * locale (`mm/dd/yyyy` on US browsers), an ambiguous format for an
 * Egypt-focused Admin, in English and in Arabic alike.
 *
 * - Type digits; the slashes are inserted for you (`29092026` → `29/09/2026`).
 *   Arabic-Indic digits are accepted and normalized.
 * - The calendar button opens the browser's picker as a convenience only; the
 *   VALUE you see is always DD/MM/YYYY.
 * - `onChange` receives ISO `YYYY-MM-DD` when the text is a real, in-range date,
 *   and `""` when the field is cleared. An impossible date (31/02/2026) or one
 *   after `max` is reported inline and never emitted.
 *
 * The text stays LTR even in Arabic: a date is a number sequence, and mirroring
 * its slashes would swap day and year.
 */
export function AdminDateInput({
  label,
  value,
  defaultValue,
  onChange,
  max,
  id,
  name,
  className,
}: {
  label: string;
  /** Controlled ISO value. */
  value?: string;
  /** Uncontrolled initial ISO value. */
  defaultValue?: string;
  onChange?: (iso: string) => void;
  /** Inclusive ISO upper bound. */
  max?: string;
  id?: string;
  /** When set, a hidden input carries the ISO value for form posts. */
  name?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const uid = useId();
  const fieldId = id ?? `${uid}-date`;
  const errId = `${fieldId}-err`;
  const pickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => formatAdminDateInput(value ?? defaultValue));
  const [iso, setIso] = useState(value ?? defaultValue ?? "");

  // A controlled value that changes from OUTSIDE (URL navigation, reset) replaces the text.
  useEffect(() => {
    if (value === undefined) return;
    if (parseAdminDate(text) !== value && !(value === "" && text !== "" && classifyAdminDate(text).status !== "valid")) {
      setText(formatAdminDateInput(value));
    }
    setIso(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const state = classifyAdminDate(text, max);
  const error = state.status === "invalid" ? t("admin.preview.dateInput.invalid") : state.status === "afterMax" ? t("admin.preview.dateInput.afterMax") : null;

  function commit(nextText: string) {
    setText(nextText);
    const s = classifyAdminDate(nextText, max);
    if (s.status === "valid") {
      setIso(s.iso);
      onChange?.(s.iso);
    } else if (s.status === "empty") {
      setIso("");
      onChange?.("");
    }
  }

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div className="relative">
        <input
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={text}
          maxLength={10}
          placeholder={t("admin.preview.dateInput.placeholder")}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => commit(maskAdminDate(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "min-h-10 w-full rounded-md border bg-canvas ps-3 pe-10 text-start text-body tabular-nums text-fg placeholder:text-fg-muted",
            "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
            error ? "border-danger" : "border-strong",
          )}
        />
        <button
          type="button"
          aria-label={t("admin.preview.dateInput.openCalendar")}
          onClick={() => pickerRef.current?.showPicker?.()}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <CalendarIcon size={16} />
        </button>
        {/* Picker helper only: never visible, never focusable, never the displayed value. */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={iso}
          max={max}
          onChange={(e) => e.target.value && commit(formatAdminDateInput(e.target.value))}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </div>
      {error ? (
        <p id={errId} role="alert" className="mt-1 text-label text-danger">
          {error}
        </p>
      ) : null}
      {name ? <input type="hidden" name={name} value={state.status === "valid" ? state.iso : ""} /> : null}
    </div>
  );
}
