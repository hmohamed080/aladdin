"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { classifyAdminTime, maskAdminTime } from "@/features/admin-preview/date-input";

/**
 * 24-hour `HH:mm` entry — the time half of the Admin standard. A native
 * `<input type="time">` shows a 12-hour AM/PM control on US-locale browsers,
 * which is as ambiguous as its date sibling. Digits only; the colon is inserted.
 */
export function AdminTimeInput({ label, id, defaultValue = "", className }: { label: string; id?: string; defaultValue?: string; className?: string }) {
  const { t } = useI18n();
  const [text, setText] = useState(defaultValue);
  const bad = classifyAdminTime(text) === "invalid";
  return (
    <div className={cn("flex flex-col", className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={5}
        value={text}
        placeholder="HH:mm"
        aria-label={label}
        aria-invalid={bad ? true : undefined}
        onChange={(e) => setText(maskAdminTime(e.target.value))}
          onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "min-h-10 w-full rounded-md border bg-canvas px-3 text-start text-body tabular-nums text-fg placeholder:text-fg-muted",
          "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
          bad ? "border-danger" : "border-strong",
        )}
      />
      {bad ? (
        <p role="alert" className="mt-1 text-label text-danger">
          {t("admin.preview.dateInput.invalidTime")}
        </p>
      ) : null}
    </div>
  );
}
