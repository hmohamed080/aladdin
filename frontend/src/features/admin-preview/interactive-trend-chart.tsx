"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { formatNumber } from "@/lib/ui/format";
import { seriesAt } from "@/components/ui/charts";

export type TrendSeries = {
  key: string;
  label: string;
  points: { label: string; value: number }[];
};

// Literal class strings so Tailwind can see every one of them.
const STROKE = ["", "stroke-series-1", "stroke-series-2", "stroke-series-3", "stroke-series-4", "stroke-series-5", "stroke-series-6"];
const BG = ["", "bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4", "bg-series-5", "bg-series-6"];
const FILL = ["", "fill-series-1", "fill-series-2", "fill-series-3", "fill-series-4", "fill-series-5", "fill-series-6"];

const VIEW_W = 100;
const VIEW_H = 100;

/**
 * Analytics multi-series chart (Phase 0D): interactive, hand-rolled SVG (the
 * same no-charting-library approach as every chart in `components/ui/charts`).
 *
 *  - **Legend toggles** — each legend entry is a real `aria-pressed` button that
 *    shows/hides its series. The last visible series cannot be hidden, so the
 *    chart never renders empty by accident.
 *  - **Hover / keyboard tooltip** — pointer-move (or ←/→ on the focused chart)
 *    moves a guide line to the nearest bucket and lists the exact values of the
 *    visible series. Values are exact; the lines are not.
 *  - **Range controls** — narrow the plotted window to the last N buckets.
 *
 * Each series is scaled to ITS OWN peak (a signups series would otherwise be a
 * flat line under a page-views series), which the caption states. The chart
 * plots fixture data and NEVER labels itself "Live".
 */
export function InteractiveTrendChart({
  series,
  ariaLabel,
  rangeControls = true,
}: {
  series: TrendSeries[];
  ariaLabel: string;
  /** Last-N-days buttons. Off for an hourly (single-day) chart, where "7d" would be meaningless. */
  rangeControls?: boolean;
}) {
  const { t, locale } = useI18n();
  const uid = useId();
  const total = series[0]?.points.length ?? 0;
  const rangeOptions = useMemo(() => (rangeControls ? [7, 14, 30].filter((n) => n < total) : []), [total, rangeControls]);

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [range, setRange] = useState<number | "all">("all");
  const [hover, setHover] = useState<number | null>(null);

  const window = range === "all" ? total : Math.min(range, total);
  const visible = series.filter((s) => !hidden.has(s.key));
  const sliced = visible.map((s) => ({ ...s, points: s.points.slice(total - window) }));
  const count = window;

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (visible.length > 1) next.add(key);
      return next;
    });
  }

  const xOf = (i: number) => (count <= 1 ? 50 : (i / (count - 1)) * VIEW_W);
  const yOf = (value: number, max: number) => 96 - (max <= 0 ? 0 : (value / max) * 92);

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (count - 1)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (count === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setHover((h) => Math.min(count - 1, Math.max(0, (h ?? (step > 0 ? -1 : count)) + step)));
    } else if (e.key === "Escape") {
      setHover(null);
    }
  }

  const labels = sliced[0]?.points ?? [];
  const step = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-md gap-y-2">
        <ul className="flex flex-wrap gap-x-2 gap-y-1.5" aria-label={t("admin.preview.analytics.chartLegendHint")}>
          {series.map((s, i) => {
            const off = hidden.has(s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(s.key)}
                  className={cn(
                    "flex min-h-8 items-center gap-1.5 rounded-pill border px-2.5 text-label transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    off ? "border-transparent text-fg-muted line-through opacity-60" : "border-strong text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", BG[seriesAt(i)])} />
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
        {rangeOptions.length > 0 ? (
          <div role="group" aria-label={t("admin.preview.analytics.chartRange")} className="flex gap-1">
            {[...rangeOptions, "all" as const].map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => {
                  setRange(r);
                  setHover(null);
                }}
                className={cn(
                  "min-h-8 rounded-sm px-2.5 text-label font-medium tabular-nums transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  range === r ? "bg-accent-solid text-on-accent" : "text-fg-secondary hover:bg-surface-2",
                )}
              >
                {r === "all" ? t("admin.preview.analytics.chartRangeAll") : t("admin.preview.analytics.chartRangeDays", { count: formatNumber(r, locale) })}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        dir="ltr"
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
        className="relative rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-44 w-full touch-none tablet:h-56"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          aria-hidden="true"
        >
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" y1={y} x2={VIEW_W} y2={y} className="stroke-chart-grid" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {sliced.map((s) => {
            const idx = series.findIndex((x) => x.key === s.key);
            const max = Math.max(1, ...s.points.map((p) => p.value));
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(2)},${yOf(p.value, max).toFixed(2)}`).join(" ");
            return (
              <path
                key={s.key}
                d={d}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className={STROKE[seriesAt(idx)]}
              />
            );
          })}
          {hover !== null ? (
            <>
              <line x1={xOf(hover)} y1="0" x2={xOf(hover)} y2={VIEW_H} className="stroke-strong" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              {sliced.map((s) => {
                const idx = series.findIndex((x) => x.key === s.key);
                const max = Math.max(1, ...s.points.map((p) => p.value));
                const p = s.points[hover];
                return p ? <circle key={s.key} cx={xOf(hover)} cy={yOf(p.value, max)} r="1.6" className={FILL[seriesAt(idx)]} /> : null;
              })}
            </>
          ) : null}
        </svg>

        {hover !== null && labels[hover] ? (
          <div
            role="status"
            id={`${uid}-tip`}
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border bg-surface px-3 py-2 text-label shadow-lg"
            style={hover > count / 2 ? { insetInlineEnd: `${100 - xOf(hover) + 2}%` } : { insetInlineStart: `${xOf(hover) + 2}%` }}
          >
            <p className="mb-1 font-medium text-fg">{labels[hover]!.label}</p>
            {sliced.map((s) => {
              const idx = series.findIndex((x) => x.key === s.key);
              return (
                <p key={s.key} className="flex items-center justify-between gap-md text-fg-secondary">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={cn("h-2 w-2 rounded-[2px]", BG[seriesAt(idx)])} />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums text-fg">{formatNumber(s.points[hover]?.value ?? 0, locale)}</span>
                </p>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex justify-between gap-2 text-[0.6875rem] text-fg-muted" dir="ltr" aria-hidden="true">
        {labels.filter((_, i) => i % step === 0 || i === labels.length - 1).map((p) => (
          <span key={p.label} className="truncate">
            {p.label}
          </span>
        ))}
      </div>
      <figcaption className="text-label text-fg-muted">{t("admin.preview.analytics.chartScaleNote")}</figcaption>
    </figure>
  );
}
