import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount, formatNumber } from "@/lib/ui/format";
import { CardRail } from "@/components/ui/card-rail";
import { KpiStrip, type Kpi } from "@/components/ui/workspace-layout";

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

function TileBody({ tile, locale }: { tile: Tile; locale: Locale }) {
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
          {typeof tile.value === "number" ? formatNumber(tile.value, locale) : tile.value}
        </span>
        <span className="mt-1 block truncate text-label text-fg-secondary">{tile.label}</span>
        {tile.hint ? <span className="mt-0.5 block truncate text-label text-fg-muted">{tile.hint}</span> : null}
      </span>
    </>
  );
}

/**
 * `strip` is the dense presentation the supply-side reference is built around:
 * one bordered instrument panel with hairline seams instead of a row of separate
 * floating cards. It is what every module that opens with three-to-six real
 * counts should use — the numbers read as ONE reading of the business rather
 * than as six unrelated cards, and it costs a third less vertical space, which
 * is the difference between the first list row being above or below the fold.
 *
 * `grid` is the older default and stays right for the three-or-four-tile strips
 * that open most modules — they fit, and a grid lets the eye compare them at a glance.
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
  locale,
  className,
  layout = "grid",
  railLabel,
  columns,
}: {
  tiles: Tile[];
  /**
   * Every tile value that arrives as a number is formatted for this locale. A
   * caller that has already formatted its own value (compact money, say) passes
   * a string and is left alone.
   */
  locale: Locale;
  className?: string;
  layout?: "grid" | "rail" | "strip";
  /** Accessible name for the scroll region. Required by `layout="rail"`. */
  railLabel?: string;
  /** Cells per row on desktop; follows the tile count when unset. `strip` only. */
  columns?: 2 | 3 | 4 | 5 | 6;
}) {
  if (layout === "strip") {
    // One shape of data, two presentations: `Tile.hint` is the same sentence a
    // `Kpi.foot` carries, so the mapping is a rename and not a translation.
    const items: Kpi[] = tiles.map((t) => ({
      label: t.label,
      value: t.value,
      Icon: t.Icon,
      tone: t.tone,
      foot: t.hint,
      href: t.href,
    }));
    return <KpiStrip items={items} locale={locale} columns={columns} className={className} />;
  }

  const cards = tiles.map((tile) =>
    tile.href ? (
      <Link
        key={tile.label}
        href={tile.href}
        className="flex items-center gap-3 rounded-md border bg-surface p-md shadow-card transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <TileBody tile={tile} locale={locale} />
      </Link>
    ) : (
      <div key={tile.label} className="flex items-center gap-3 rounded-md border bg-surface p-md shadow-card">
        <TileBody tile={tile} locale={locale} />
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
 *
 * `keep` exists because tabs and a `FilterBar` share one query string. Without it,
 * switching tab silently DROPS whatever the toolbar had set — a seller who
 * searched their catalogue and then clicked "Drafts" would land on all drafts
 * with the search box still showing their term. The two controls have to compose,
 * so each tab link carries the sibling filters forward and changes only its own
 * parameter.
 */
export function TabLinks({
  basePath,
  param,
  current,
  tabs,
  label,
  locale,
  keep,
}: {
  basePath: string;
  param: string;
  /** Empty string = the "all" tab. */
  current: string;
  tabs: { value: string; label: string; count?: number }[];
  label: string;
  /** The per-tab count pills are user-facing numbers, so they follow the reader. */
  locale: Locale;
  /** Sibling query parameters to carry across a tab change. Empty values drop. */
  keep?: Record<string, string | undefined>;
}) {
  const hrefFor = (value: string) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(keep ?? {})) if (v) qs.set(k, v);
    if (value) qs.set(param, value);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    /* `overflow-y-hidden` is not redundant: a lone `overflow-x: auto` makes the
       OTHER axis `auto` too, and the tab row's bottom rule is a pixel outside its
       box — enough for Chrome to paint a stub vertical scrollbar beside the
       tabs. It has nothing to scroll to; it is pure artifact. */
    <nav aria-label={label} className="mb-lg -mx-1 overflow-x-auto overflow-y-hidden">
      <ul className="flex w-max min-w-full gap-1 border-b px-1">
        {tabs.map((tab) => {
          const active = tab.value === current;
          const href = hrefFor(tab.value);
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
                    {formatCount(tab.count, locale)}
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
