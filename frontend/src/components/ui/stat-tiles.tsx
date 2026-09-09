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

/**
 * ONE surface, not a card inside a card. `.workspace-body .bg-surface`
 * (globals.css) already applies this shell's whole elevation grammar — a
 * low-contrast border-color plus a soft two-layer shadow — to every
 * `bg-surface` element via `!important`, unconditionally. Also requesting
 * Tailwind's own `border` (a solid 1px edge) and `shadow-card` (a second,
 * heavier shadow token) on top of that stacked a visible border ring *and* a
 * near-edge shadow layer around a tile barely 90px tall, which read as a
 * picture frame rather than a single lifted surface — the "card inside a
 * card" defect. Dropping both Tailwind utilities here removes the border
 * entirely (its color has no width left to draw) and leaves the shell's own
 * soft shadow as the tile's only separation cue. The icon chip above is the
 * one deliberately contrasting surface left inside the tile.
 */
const tileSurfaceClass =
  "flex items-center gap-3 rounded-md bg-surface p-md transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

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
        {/* `break-words`, not `truncate`. A clipped KPI label or an ellipsized
            money figure is a defect, not a guard — the requirement is to WRAP a
            long label onto a second line rather than hide part of it. `min-w-0`
            on the wrapping span (above) is what actually stops the tile from
            being pushed wide by an unbroken token; wrapping is the presentation
            once that space constraint is real. Callers should still pass a
            value that fits comfortably (the compact money format on tiles, the
            exact figure on the record the tile links to) — this is the safety
            net for the rare label that doesn't. */}
        {/* `min-h-[3.125rem]` reserves two lines of `text-title` (20px ×
            leading-tight's 1.25 = 25px/line) the same way the label below
            reserves two of its own — measured necessary because the compact
            money value ("١٤٨٫٧ ألف ج.م.") genuinely wraps onto a second line
            in a 178px card while every other tile's plain digit does not,
            and that one wrap was stretching the whole six-card primary row
            (shared CSS Grid row) taller than the hint-less secondary row's
            own, separate grid instance. */}
        <span className="block min-h-[3.125rem] break-words font-display text-title leading-tight text-fg tabular-nums">
          {typeof tile.value === "number" ? formatNumber(tile.value, locale) : tile.value}
        </span>
        {/* `min-h-10` reserves the full two-line height (13px label ×
            leading-normal's 1.5 ≈ 39px, rounded up to Tailwind's 40px step)
            whether THIS label actually wraps or not. Without it, a tile
            whose label happens to fit on one line is shorter than a sibling
            whose label wraps — invisible while every tile shares one CSS
            Grid row (the row auto-stretches everything to the tallest
            member), but the collapsed/expanded KPI sections are two
            SEPARATE grid instances (only the second one collapses), so
            nothing stretches the two secondary cards to match the six
            primary ones unless each card already reserves the same space.
            `leading-normal` (not the tighter `leading-snug` this used to
            carry) is deliberate: at `leading-snug` a two-line Arabic label
            ("طلبات قيد التنفيذ") read as its two lines running into each
            other — Arabic script needs more inter-line room than Latin at
            the same nominal ratio. */}
        <span className="mt-1 block min-h-10 break-words text-label leading-normal text-fg-secondary">
          {tile.label}
        </span>
        {/* Rendered unconditionally, not only `{tile.hint ? ... : null}` —
            reserving this line's height (`min-h-5`) regardless of whether
            THIS tile has a hint is what keeps every card the same height.
            Two `StatTiles` calls (primary/secondary) are separate CSS Grid
            instances; only ONE primary tile (Total Purchases) carries a
            hint, but that alone used to stretch the whole six-card row
            taller than the hint-less secondary row by exactly one hint
            line — invisible in isolation, visible the moment the two rows
            sit one above the other. */}
        <span className="mt-0.5 block min-h-5 break-words text-label leading-snug text-fg-muted">{tile.hint}</span>
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
      <Link key={tile.label} href={tile.href} className={tileSurfaceClass}>
        <TileBody tile={tile} locale={locale} />
      </Link>
    ) : (
      <div key={tile.label} className={tileSurfaceClass}>
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
        "grid grid-cols-2 gap-sm [&>*]:min-w-0",
        columns ? GRID_COLUMNS[columns] : "tablet:grid-cols-3 desktop:grid-cols-4",
        className,
      )}
    >
      {cards}
    </div>
  );
}

/**
 * Tailwind class names must appear as literal strings for the compiler to
 * find them — `desktop:grid-cols-${columns}` would never ship the class it
 * builds. A lookup table is the honest way to make `columns` configurable.
 */
const GRID_COLUMNS: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: "tablet:grid-cols-2 desktop:grid-cols-2",
  3: "tablet:grid-cols-3 desktop:grid-cols-3",
  4: "tablet:grid-cols-4 desktop:grid-cols-4",
  5: "tablet:grid-cols-3 desktop:grid-cols-5",
  6: "tablet:grid-cols-3 desktop:grid-cols-6",
};

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
                    : "border-transparent text-fg-secondary hover:border-strong hover:text-fg",
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
