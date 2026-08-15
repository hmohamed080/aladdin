import { cn } from "@/lib/ui/cn";

/**
 * A labelled proportion list — the workspace's one "chart".
 *
 * Why bars and not a donut or a plotting library: the design system fixes a single
 * accent and forbids inventing colours, so a categorical palette would have to be
 * added through governance before any multi-series chart could exist. A ranked bar
 * list reads accurately in one accent, works in both themes, mirrors correctly in
 * RTL (logical widths), needs no runtime dependency, and — unlike a donut — stays
 * legible with two categories or with twelve.
 *
 * Server-safe. Values are absolute; the bar is scaled against the largest value so
 * a small set still shows contrast.
 */
export type BreakdownItem = {
  label: string;
  value: number;
  /** Optional right-hand annotation (formatted money, percentage, count). */
  detail?: string;
};

export function Breakdown({
  items,
  emptyLabel,
  className,
}: {
  items: BreakdownItem[];
  emptyLabel: string;
  className?: string;
}) {
  const shown = items.filter((i) => i.value > 0);
  if (shown.length === 0) {
    return <p className={cn("text-body text-fg-muted", className)}>{emptyLabel}</p>;
  }
  const max = Math.max(...shown.map((i) => i.value));

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {shown.map((item) => (
        <li key={item.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-md">
            <span className="min-w-0 truncate text-body text-fg-secondary">{item.label}</span>
            <span className="shrink-0 text-label font-medium tabular-nums text-fg" dir="ltr">
              {item.detail ?? item.value}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-accent-solid"
              style={{ width: `${Math.max((item.value / max) * 100, 4)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
