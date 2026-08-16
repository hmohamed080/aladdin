import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/ui/cn";
import { CardRail } from "@/components/ui/card-rail";

/**
 * The KPI strip that opens every showroom module — one canonical implementation.
 *
 * Rules that keep it honest rather than decorative:
 *  - Every tile is a REAL count from the same RLS-scoped query that fills the list
 *    below it. No estimates, no targets, no invented deltas.
 *  - A tile with an `href` is a filter shortcut into the list, not a dead number.
 *  - Tone is semantic, not decorative: `danger` means something is overdue,
 *    `warning` means something is waiting on the user.
 *
 * Server-safe (no client hooks).
 */
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export type Tile = {
  label: string;
  value: number | string;
  Icon: ComponentType<{ size?: number }>;
  tone?: Tone;
  /** One short line under the label — context, never a fabricated trend. */
  hint?: string;
  href?: string;
};

const chip: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-solid/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
};

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <span
        className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-sm", chip[tile.tone ?? "neutral"])}
        aria-hidden="true"
      >
        <tile.Icon size={20} />
      </span>
      <span className="min-w-0">
        {/* `truncate` is a GUARD, not the plan. A tile is ~180px wide in the
            two-column mobile grid, and a long value (a money figure, say) has no
            natural break point — without this it overflowed the tile and pushed
            the whole page sideways. Callers should still pass a value that fits:
            use the compact money format on tiles, and keep the exact figure on
            the record the tile links to. */}
        <span className="block truncate font-display text-title leading-none text-fg tabular-nums">
          {tile.value}
        </span>
        <span className="mt-1 block truncate text-label text-fg-secondary">{tile.label}</span>
        {tile.hint ? <span className="mt-0.5 block truncate text-label text-fg-muted">{tile.hint}</span> : null}
      </span>
    </>
  );
}

/**
 * `grid` is the default and stays right for the three-or-four-tile strips that
 * open most modules — they fit, and a grid lets the eye compare them at a glance.
 *
 * `rail` is for the long strips (the dashboard's eight, Reports' six). Two things
 * make it the better answer there: the row stays one row instead of pushing the
 * real content below the fold, and a railed card does not SHRINK — which is what
 * used to truncate "EGP 1,103,100.00" when six money tiles shared a laptop width.
 * Where every tile fits, the rail renders no controls and is indistinguishable
 * from a row of cards.
 */
export function StatTiles({
  tiles,
  className,
  layout = "grid",
  railLabel,
}: {
  tiles: Tile[];
  className?: string;
  layout?: "grid" | "rail";
  /** Accessible name for the scroll region. Required by `layout="rail"`. */
  railLabel?: string;
}) {
  const cards = tiles.map((tile) =>
    tile.href ? (
      <Link
        key={tile.label}
        href={tile.href}
        className="flex items-center gap-3 rounded-md border bg-surface p-md shadow-card transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <TileBody tile={tile} />
      </Link>
    ) : (
      <div key={tile.label} className="flex items-center gap-3 rounded-md border bg-surface p-md shadow-card">
        <TileBody tile={tile} />
      </div>
    ),
  );

  if (layout === "rail") {
    return (
      <CardRail label={railLabel ?? ""} itemWidth="13rem" className={className}>
        {cards}
      </CardRail>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-sm tablet:grid-cols-3 desktop:grid-cols-4 [&>*]:min-w-0",
        className,
      )}
    >
      {cards}
    </div>
  );
}

/**
 * Status filter tabs expressed as links (`?status=…`), so the whole list stays a
 * server component and the filter survives a refresh or a shared URL.
 */
export function TabLinks({
  basePath,
  param,
  current,
  tabs,
  label,
}: {
  basePath: string;
  param: string;
  /** Empty string = the "all" tab. */
  current: string;
  tabs: { value: string; label: string; count?: number }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-lg -mx-1 overflow-x-auto">
      <ul className="flex w-max min-w-full gap-1 border-b px-1">
        {tabs.map((tab) => {
          const active = tab.value === current;
          const href = tab.value ? `${basePath}?${param}=${encodeURIComponent(tab.value)}` : basePath;
          return (
            <li key={tab.value || "all"}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-label font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                  active
                    ? "border-accent-solid text-fg"
                    : "border-transparent text-fg-secondary hover:border-border-strong hover:text-fg",
                )}
              >
                {tab.label}
                {typeof tab.count === "number" ? (
                  <span
                    className={cn(
                      "rounded-pill px-1.5 py-px text-[0.6875rem] tabular-nums",
                      active ? "bg-accent-solid/15 text-accent" : "bg-surface-2 text-fg-muted",
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
