import { StarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { starFill } from "@/lib/reviews/summary";

/**
 * Shared review pieces.
 *
 * Server components: none of them takes an action or holds state, and the
 * Reviews page is a read surface. Only the poster's form is a client component,
 * because only it submits anything.
 */

/**
 * Five stars, filled to a value.
 *
 * ONE ICON, TWO COLOURS. There is no separate outline star in the icon set, and
 * adding one to render an empty state would be a second asset saying what a
 * token already says — so an unearned star is the same glyph in the muted
 * foreground. The half star is a clipped overlay rather than a third asset, for
 * the same reason.
 *
 * ALWAYS ACCOMPANIED BY THE NUMERAL at summary size. Stars are the impression;
 * the number is the fact, and a person being judged by it deserves to read it
 * exactly rather than count shapes.
 */
export function Stars({
  value,
  size = 16,
  label,
}: {
  value: number;
  size?: number;
  /** Screen-reader text. Required — a row of glyphs announces nothing on its own. */
  label: string;
}) {
  const filled = starFill(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => {
        const whole = filled >= star;
        const half = !whole && filled >= star - 0.5;
        return (
          <span key={star} aria-hidden="true" className="relative inline-flex">
            <StarIcon size={size} className={whole ? "text-warning" : "text-fg-muted/40"} />
            {half ? (
              <span className="absolute inset-0 overflow-hidden" style={{ width: "50%" }}>
                <StarIcon size={size} className="text-warning" />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/**
 * One bar of the 5→1 distribution.
 *
 * The count is shown beside the percentage because a percentage alone is
 * misleading at low volume — "100%" from a single review says something very
 * different from "100%" from ninety, and a professional's first review should not
 * read as a perfect record.
 */
export function DistributionRow({
  stars,
  count,
  percent,
  label,
}: {
  stars: number;
  count: number;
  percent: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-label text-fg-secondary">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2">
        <span
          className="block h-full rounded-pill bg-warning"
          style={{ width: `${percent}%` }}
          data-testid={`distribution-bar-${stars}`}
        />
      </span>
      <span className="w-20 shrink-0 text-end text-label tabular-nums text-fg-muted">
        {percent}% ({count})
      </span>
    </div>
  );
}

/** The card frame every review sits in, so the three surfaces cannot drift apart. */
export function ReviewShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("flex flex-col gap-2", className)}>{children}</div>;
}
