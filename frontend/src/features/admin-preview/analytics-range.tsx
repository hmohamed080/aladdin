"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

export type RangePreset = "today" | "7" | "30" | "custom";

const inputClass =
  "min-h-10 rounded-md border border-strong bg-canvas px-3 text-body text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40";

/**
 * Analytics date range: Today · Last 7 days · Last 30 days · Custom (From–To).
 * URL-driven (`?range=today|7|30|custom&from=&to=`) and auto-applying — a
 * preset click or a completed From/To pair navigates immediately (soft
 * navigation, no scroll jump), with no Apply/Search button. Custom needs both
 * dates and rejects an inverted pair instead of guessing.
 */
export function AnalyticsRange({ current, from, to, max }: { current: RangePreset; from: string; to: string; max: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showCustom, setShowCustom] = useState(current === "custom");
  const invalid = customFrom !== "" && customTo !== "" && customFrom > customTo;

  function go(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const k of ["range", "from", "to"]) params.delete(k);
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const presets: { value: Exclude<RangePreset, "custom">; label: string }[] = [
    { value: "today", label: t("admin.preview.analytics.presets.today") },
    { value: "7", label: t("admin.preview.analytics.presets.last7") },
    { value: "30", label: t("admin.preview.analytics.presets.last30") },
  ];

  return (
    <div className="flex flex-col gap-sm">
      <div role="group" aria-label={t("admin.preview.analytics.dateRange")} className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={current === p.value}
            onClick={() => {
              setShowCustom(false);
              go({ range: p.value });
            }}
            className={cn(
              "min-h-10 rounded-md border px-3.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              current === p.value ? "border-accent bg-accent-solid text-on-accent" : "border-strong text-fg-secondary hover:bg-surface-2",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={current === "custom" || showCustom}
          onClick={() => setShowCustom(true)}
          className={cn(
            "min-h-10 rounded-md border px-3.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
            current === "custom" || showCustom ? "border-accent bg-accent-solid text-on-accent" : "border-strong text-fg-secondary hover:bg-surface-2",
          )}
        >
          {t("admin.preview.analytics.presets.custom")}
        </button>
      </div>

      {showCustom ? (
        <div className="flex flex-wrap items-end gap-sm">
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {t("admin.preview.analytics.from")}
            <input
              type="date"
              value={customFrom}
              max={max}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                if (e.target.value && customTo && e.target.value <= customTo) go({ range: "custom", from: e.target.value, to: customTo });
              }}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-label text-fg-secondary">
            {t("admin.preview.analytics.to")}
            <input
              type="date"
              value={customTo}
              max={max}
              onChange={(e) => {
                setCustomTo(e.target.value);
                if (customFrom && e.target.value && customFrom <= e.target.value) go({ range: "custom", from: customFrom, to: e.target.value });
              }}
              className={inputClass}
              aria-invalid={invalid || undefined}
            />
          </label>
          {invalid ? <p role="alert" className="text-label text-danger">{t("admin.preview.analytics.invalidRange")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
