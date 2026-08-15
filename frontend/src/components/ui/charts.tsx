import { cn } from "@/lib/ui/cn";

/**
 * The workspace's chart primitives.
 *
 * WHY THESE ARE HAND-WRITTEN AND NOT A LIBRARY
 * Every charting library ships a canvas/DOM renderer that must run on the client,
 * which would turn these server-rendered analytics pages into client components
 * for the sake of four shapes. The shapes a purchasing report actually needs — a
 * trend line, a proportional split, a ranked comparison, a funnel — are a path, a
 * dashed circle, a flex row and a list. Inline SVG draws all four, renders on the
 * server, costs no bytes of JavaScript, and inherits the theme automatically
 * because its fills are token variables rather than baked hex.
 *
 * RULES EVERY CHART HERE FOLLOWS
 *  - Colour is a SECOND channel, never the only one. Every series is labelled in
 *    text, so the chart is still readable in greyscale or with a colour-vision
 *    deficiency.
 *  - Each chart is `role="img"` with an `aria-label` naming the chart, and carries
 *    an `sr-only` list of its actual values — a screen reader gets the DATA, not a
 *    description of a picture.
 *  - Direction: value/time axes stay LTR in both locales (an Arabic dashboard
 *    still reads a January→June trend left to right, and digits are LTR anyway),
 *    while ranked bars and legends — which are text lists — follow the document
 *    direction and grow from the inline start.
 *  - Empty is a first-class state. A chart with nothing behind it renders a
 *    sentence, never an empty axis pretending to be a measurement.
 */

export type Series = 1 | 2 | 3 | 4 | 5 | 6;

/** Tailwind cannot see a class name built at runtime, so the maps are explicit. */
const TEXT: Record<Series, string> = {
  1: "text-series-1",
  2: "text-series-2",
  3: "text-series-3",
  4: "text-series-4",
  5: "text-series-5",
  6: "text-series-6",
};
const STROKE: Record<Series, string> = {
  1: "stroke-series-1",
  2: "stroke-series-2",
  3: "stroke-series-3",
  4: "stroke-series-4",
  5: "stroke-series-5",
  6: "stroke-series-6",
};
const BG: Record<Series, string> = {
  1: "bg-series-1",
  2: "bg-series-2",
  3: "bg-series-3",
  4: "bg-series-4",
  5: "bg-series-5",
  6: "bg-series-6",
};

/** Cycle the palette so a list of any length still alternates predictably. */
export function seriesAt(index: number): Series {
  return ((index % 6) + 1) as Series;
}

function Empty({ label, className }: { label: string; className?: string }) {
  return <p className={cn("py-lg text-center text-body text-fg-muted", className)}>{label}</p>;
}

/**
 * An accessible transcript of the plotted values, for readers that cannot see the
 * shape. Visually hidden, never a duplicate of anything on screen.
 */
function DataList({ caption, items }: { caption: string; items: { label: string; value: string }[] }) {
  return (
    <ul className="sr-only">
      <li>{caption}</li>
      {items.map((i) => (
        <li key={i.label}>
          {i.label}: {i.value}
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================
// Trend line
// ===========================================================================

export type TrendPoint = {
  /** Short axis label — a month or a week, already localised. */
  label: string;
  value: number;
};

/**
 * A value-over-time line with a soft area fill.
 *
 * The plot is drawn in a unit viewBox stretched to the container
 * (`preserveAspectRatio="none"`), which keeps the chart fluid at every width;
 * `vector-effect="non-scaling-stroke"` stops that stretch from thickening the
 * line. Axis labels are HTML around the plot rather than `<text>` inside it, so
 * they keep their real font size instead of scaling down to nothing on a phone.
 */
export function TrendLine({
  points,
  emptyLabel,
  ariaLabel,
  formatValue,
  series = 1,
}: {
  points: TrendPoint[];
  emptyLabel: string;
  ariaLabel: string;
  /** Formats the axis bounds and the screen-reader transcript (money, counts…). */
  formatValue: (v: number) => string;
  series?: Series;
}) {
  if (points.length < 2 || points.every((p) => p.value === 0)) {
    return <Empty label={emptyLabel} />;
  }

  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;

  // Unit space: x across the full width, y inverted (SVG y grows downward) and
  // inset by 2% top and bottom so the peak's stroke is never clipped.
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = 98 - ((p.value - min) / span) * 96;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${coords.join(" L")}`;
  const area = `${line} L100,100 L0,100 Z`;

  // A long series would cram the axis; show at most six labels, always including
  // the first and last so the range the chart covers is unambiguous.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const shown = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between py-0.5 text-[0.6875rem] tabular-nums text-fg-muted"
          dir="ltr"
          aria-hidden="true"
        >
          <span>{formatValue(max)}</span>
          <span>{formatValue(min)}</span>
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel}
          /* The series colour lives on the <svg> itself: `currentColor` inside a
             gradient stop resolves against the GRADIENT's inherited colour, not
             the element that references it, so colouring the path alone would
             leave the area fill black. */
          className={cn("h-36 w-full tablet:h-44", TEXT[series])}
        >
          <defs>
            <linearGradient id={`trend-fade-${series}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Three reference rules — enough to read a level against, few enough
              not to compete with the line itself. */}
          {[25, 50, 75].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              className="stroke-chart-grid"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#trend-fade-${series})`} />
          <path
            d={line}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={STROKE[series]}
          />
        </svg>
      </div>
      <div className="flex justify-between gap-2 ps-8 text-[0.6875rem] text-fg-muted" dir="ltr" aria-hidden="true">
        {shown.map((p) => (
          <span key={p.label} className="truncate">
            {p.label}
          </span>
        ))}
      </div>
      <DataList
        caption={ariaLabel}
        items={points.map((p) => ({ label: p.label, value: formatValue(p.value) }))}
      />
    </figure>
  );
}

// ===========================================================================
// Proportional split
// ===========================================================================

export type Slice = { label: string; value: number };

/**
 * A donut with a labelled legend.
 *
 * Drawn with the stroke-dasharray technique on a single circle per slice: the
 * circumference of an r=15.9155 circle is almost exactly 100, so a slice's
 * percentage IS its dash length and no arc trigonometry is needed. Uniform
 * scaling keeps the ring perfectly circular at any width.
 *
 * The legend is not decoration — it is how the chart is actually read, so it
 * carries the label, the absolute value and the share for every slice.
 */
export function DonutSplit({
  slices,
  emptyLabel,
  ariaLabel,
  centerLabel,
  formatValue,
  formatShare,
}: {
  slices: Slice[];
  emptyLabel: string;
  ariaLabel: string;
  /** The word under the total in the ring's hole (e.g. "Total spend"). */
  centerLabel: string;
  formatValue: (v: number) => string;
  /** Shares must be formatted in the same numeral system as the values beside them. */
  formatShare: (pct: number) => string;
}) {
  const shown = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = shown.reduce((s, i) => s + i.value, 0);
  if (total === 0) return <Empty label={emptyLabel} />;

  let offset = 0;
  const arcs = shown.map((s, i) => {
    const pct = (s.value / total) * 100;
    // Dash offset runs clockwise from 12 o'clock because of the -90° rotation
    // below; each slice starts where the previous one ended.
    const arc = { ...s, pct, series: seriesAt(i), dash: pct, gap: 100 - pct, offset: 25 - offset };
    offset += pct;
    return arc;
  });

  return (
    <figure className="m-0 flex flex-col items-center gap-lg tablet:flex-row tablet:items-center">
      <div className="relative shrink-0">
        <svg viewBox="0 0 36 36" role="img" aria-label={ariaLabel} className="h-36 w-36">
          <circle cx="18" cy="18" r="15.9155" fill="none" className="stroke-surface-2" strokeWidth="4" />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              strokeWidth="4"
              strokeDasharray={`${a.dash} ${a.gap}`}
              strokeDashoffset={a.offset}
              className={STROKE[a.series]}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <span dir="ltr" className="block text-body-lg font-semibold tabular-nums text-fg">
              {formatValue(total)}
            </span>
            <span className="block text-[0.6875rem] text-fg-muted">{centerLabel}</span>
          </div>
        </div>
      </div>

      <ul className="flex w-full min-w-0 flex-col gap-1.5">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center gap-2 text-label">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", BG[a.series])} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-fg-secondary">{a.label}</span>
            <span dir="ltr" className="shrink-0 tabular-nums text-fg-muted">
              {formatValue(a.value)}
            </span>
            <span className="w-12 shrink-0 text-end tabular-nums font-medium text-fg">
              {formatShare(Math.round(a.pct))}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ===========================================================================
// Ranked comparison
// ===========================================================================

export type RankedItem = {
  label: string;
  value: number;
  /** Formatted annotation shown at the end of the row (money, "12 orders"…). */
  detail?: string;
  /** Optional second line under the label. */
  meta?: string;
};

/**
 * A horizontal ranked bar list — "top distributors by order value".
 *
 * HTML and CSS rather than SVG on purpose: a bar that must grow from the reading
 * edge is exactly what a block element in a flow container already does, so this
 * mirrors correctly in Arabic for free, wraps long business names, and keeps its
 * labels at true font size.
 */
export function RankedBars({
  items,
  emptyLabel,
  colored = false,
  className,
}: {
  items: RankedItem[];
  emptyLabel: string;
  /** Give each row its own series colour (use for entities, not for statuses). */
  colored?: boolean;
  className?: string;
}) {
  const shown = items.filter((i) => i.value > 0);
  if (shown.length === 0) return <Empty label={emptyLabel} className="py-md text-start" />;
  const max = Math.max(...shown.map((i) => i.value));

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {shown.map((item, i) => (
        <li key={item.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-md">
            <span className="min-w-0 truncate text-body text-fg-secondary">{item.label}</span>
            <span className="shrink-0 text-label font-medium tabular-nums text-fg" dir="ltr">
              {item.detail ?? item.value}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className={cn("h-full rounded-pill", colored ? BG[seriesAt(i)] : "bg-accent-solid")}
              style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }}
            />
          </div>
          {item.meta ? <p className="mt-0.5 truncate text-[0.6875rem] text-fg-muted">{item.meta}</p> : null}
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================
// Funnel
// ===========================================================================

export type FunnelStep = { label: string; value: number };

/**
 * The request → offer → order funnel.
 *
 * Each step is measured against the FIRST step, not against the widest bar, so
 * the taper carries the actual drop-off. The conversion figure between steps is
 * printed rather than left to be eyeballed off the bar widths — that number is
 * the whole reason a buyer looks at a funnel.
 */
export function Funnel({
  steps,
  emptyLabel,
  ofFirstLabel,
}: {
  steps: FunnelStep[];
  emptyLabel: string;
  /** Renders the drop-off line, e.g. "48% of requests sent". */
  ofFirstLabel: (pct: number) => string;
}) {
  const head = steps[0];
  if (!head || head.value === 0) return <Empty label={emptyLabel} className="py-md text-start" />;

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / head.value) * 100);
        return (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-md">
              <span className="min-w-0 truncate text-body text-fg-secondary">{s.label}</span>
              <span className="shrink-0 text-label font-medium tabular-nums text-fg" dir="ltr">
                {s.value}
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className={cn("h-full rounded-pill", BG[seriesAt(i)])}
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
            {i > 0 ? <p className="mt-0.5 text-[0.6875rem] text-fg-muted">{ofFirstLabel(pct)}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
