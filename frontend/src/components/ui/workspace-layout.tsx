import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount, formatNumber, formatPercent } from "@/lib/ui/format";
import { PlusIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/controls";

/**
 * THE DENSE WORKSPACE LAYER — the shared composition primitives every
 * supply-side surface is built from.
 *
 * WHY THESE EXIST
 * The seller workspace was functionally right and visually wrong: it read as a
 * single column of equally-weighted cards, so a Distributor's dashboard and a
 * Showroom's dashboard looked like the same page with different words on it. The
 * Distributor reference family is a different SHAPE — a banded page head, a tight
 * KPI strip that reads as one instrument rather than six loose tiles, a wide
 * working column with a narrow context column beside it, and a row of real next
 * steps at the foot. That shape is what these components encode.
 *
 * WHY THEY ARE SHARED AND NOT `supply/`
 * Distributor, Manufacturer and Importer are ONE workspace (see
 * lib/workspace/supply-side), so there is nothing here that a manufacturer gets
 * and an importer does not. And nothing here knows about a stance at all: these
 * are layout primitives, so a buyer-seat page that wants the same density gets it
 * by using them. What must never happen is three copies of this file.
 *
 * Every component is server-safe (no client hooks), so pages stay server
 * components and keep rendering their data without a round trip.
 */

/* ------------------------------------------------------------------------- */

/**
 * The page head band.
 *
 * The reference opens every screen the same way: a tinted icon tile, the module
 * name, and one line saying what the module is for — then the page's own actions
 * on the far side. The icon is not decoration; on a workspace with seventeen
 * modules it is the fastest "am I in the right place" signal there is, and it is
 * the same glyph the sidebar uses for that module.
 */
export function PageHead({
  title,
  subtitle,
  Icon,
  eyebrow,
  count,
  locale,
  actions,
  toolbar,
  density = "default",
}: {
  title: string;
  subtitle?: string;
  Icon?: ComponentType<{ size?: number }>;
  /** Small line above the title — the organization, or the section it sits in. */
  eyebrow?: string;
  /** Record count, shown as a pill beside the title. */
  count?: number;
  /**
   * REQUIRED, even on a head with no count.
   *
   * It is required rather than optional-with-a-default precisely because a
   * default would be a silent wrong answer: a head that forgot to pass it would
   * print Latin digits in an Arabic workspace and look plausible. Required, the
   * compiler proves that every page head in the app renders its count in the
   * reader's own numerals.
   */
  locale: Locale;
  /** Primary actions (a create button, a link out). */
  actions?: ReactNode;
  /** Secondary controls that belong to the whole page (sort, export, help). */
  toolbar?: ReactNode;
  /**
   * How much air the band carries beneath it.
   *
   * `default` is the reading rhythm every module page uses and does not move.
   * `compact` is for a page whose FIRST ROW is itself an instrument — the supply
   * dashboard opens on a KPI strip, and a full-height band above a row of live
   * figures spends the top of the fold on saying the module's name twice (the
   * sidebar already highlights it, and the icon tile repeats the glyph).
   *
   * It buys the space back from PADDING only. The eyebrow, the title size, the
   * subtitle and the icon are untouched, because those are the hierarchy — a
   * denser head is not a smaller one.
   */
  density?: "default" | "compact";
}) {
  const compact = density === "compact";
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between border-b",
        compact ? "gap-sm pb-sm" : "gap-md pb-md",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-md bg-accent-solid/15 text-accent"
          >
            <Icon size={22} />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="truncate text-label text-fg-muted">{eyebrow}</p> : null}
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-headline text-fg">{title}</h1>
            {typeof count === "number" ? (
              <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-pill bg-surface-2 px-2 py-0.5 text-label font-medium text-fg-secondary tabular-nums">
                {formatCount(count, locale)}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className={cn("text-body text-fg-secondary", compact ? "mt-0" : "mt-0.5")}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {actions || toolbar ? (
        <div className="flex shrink-0 flex-wrap items-center gap-sm">
          {toolbar}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export type KpiTone = "neutral" | "accent" | "iris" | "success" | "warning" | "danger" | "info";

/**
 * A period-over-period movement, measured — never decorative.
 *
 * The reference puts "+18% ↑ from last month" under every tile, and for a long
 * time this file refused to render one at all, on the grounds that nothing in
 * the database produced a comparison period. That was true of the QUERY, not of
 * the data: the rows the dashboard already reads carry `created_at` and
 * `confirmed_at`, so a window and the window before it can be counted from the
 * very same rows, at no extra cost (see `supplySummary`'s `compareDays`).
 *
 * What has not changed is the rule. A delta is rendered ONLY where a real
 * previous window with a non-zero baseline exists. "First month of trading" has
 * no percentage — not 0%, not ∞%, not "new" dressed up as growth — and the tile
 * falls back to its `foot` line instead. `pct` being a number is therefore a
 * PROMISE that a baseline existed; the caller must omit the whole object rather
 * than pass a placeholder.
 */
export type KpiDelta = {
  /** Signed change against the previous window of equal length, in percent. */
  pct: number;
  /**
   * Whether this movement is GOOD, which only the caller can know: an order
   * value rising is good, unanswered requests rising is not, and a metric with
   * no inherent direction passes `null` and gets a neutral colour. Colour is
   * never derived from the sign here — that is how a dashboard ends up painting
   * "unanswered requests +40%" in success green.
   */
  better: boolean | null;
  /** The comparison window in words — "vs. the previous 30 days". */
  label: string;
};

export type Kpi = {
  label: string;
  value: number | string;
  Icon: ComponentType<{ size?: number }>;
  tone?: KpiTone;
  /** The unit the value is counted in — "orders", "EGP". Never a fake trend. */
  unit?: string;
  /** One short line at the foot of the cell: context, or where the link goes. */
  foot?: string;
  /** Real movement against the previous window, or absent. Never fabricated. */
  delta?: KpiDelta;
  href?: string;
};

/* 20%, one alpha for every tone — and 20 rather than 18 for a reason that has
 * nothing to do with taste.
 *
 * Iris sat at 12% while its neighbours sat at 15%, and a cool violet is already
 * the quietest hue in this set on a warm ground, so the two iris cells read as
 * having no tile at all. Raising everything to a single, more visible alpha was
 * the fix — but the first attempt used 18%, and 18 IS NOT ON TAILWIND'S OPACITY
 * SCALE (it runs in steps of five). An off-scale modifier emits no rule at all,
 * silently, so every tile on the strip lost its background entirely and the
 * "fix" made the exact problem it was fixing strictly worse.
 *
 * See `opacity-scale.test.ts`, which now fails the build for any `/NN` off the
 * scale — this same trap had already eaten every soft badge tone in the product
 * once before, and had left the panel-header washes below dead since the day
 * they were written. */
const kpiChip: Record<KpiTone, string> = {
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-solid/20 text-accent",
  iris: "bg-iris-solid/20 text-iris",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  danger: "bg-danger/20 text-danger",
  info: "bg-info/20 text-info",
};

/**
 * The KPI strip — one instrument, not a row of loose cards.
 *
 * HOW THE HAIRLINES WORK, AND WHY IT MATTERS
 * Every cell draws its own END and BOTTOM edge, and the inner grid is pulled a
 * pixel past the container on those two sides so the outermost of those edges
 * slides under the container's own border instead of doubling it. That is what
 * makes the seams correct at ANY column count and at every breakpoint, with no
 * arithmetic: two columns on a phone, three on a tablet, five or six on a
 * desktop, and a part-filled last row that simply ends.
 *
 * The two obvious alternatives both fail here. `divide-x` places its rules by
 * child ORDER, so it draws them in the wrong places the moment a row wraps. And
 * a gap-over-a-tinted-background gives perfect hairlines but paints the empty
 * remainder of a part-filled row in the border colour — a grey block where a
 * sixth KPI is not. `border-e` is a logical property, so this mirrors in Arabic
 * for free, which a `border-l` version would not.
 *
 * WHAT A CELL MAY CONTAIN
 * A real count or total from the same query that fills the page, a unit, one
 * line of context, and — where and only where a real previous window exists — a
 * measured delta against it. See `KpiDelta` for the rule that keeps that honest.
 *
 * THE HEADER BAR
 * A strip whose figures are scoped to a PERIOD has to say so, and it has to say
 * so inside its own border. A period control floating above the strip, or
 * parked in the page head next to the module title, reads as scoping the whole
 * page — which it does not: the queues below are live work and are not, and must
 * not be, filtered by a date window. Putting the control in the strip's own
 * header binds it visually to exactly the numbers it governs.
 */
export function KpiStrip({
  items,
  locale,
  columns,
  className,
  title,
  toolbar,
}: {
  items: Kpi[];
  /** Names what the strip measures. Rendered only alongside a header bar. */
  title?: string;
  /**
   * Controls that scope THESE FIGURES and nothing else — a period selector.
   * Anything that scopes the whole page belongs in `PageHead`.
   */
  toolbar?: ReactNode;
  /**
   * A `Kpi.value` may arrive as an already-formatted string (compact money, from
   * a caller that knows the shape it wants) or as a RAW NUMBER, which is the
   * common case for a count. The raw ones are formatted here so that no page can
   * put "12" next to "١٢" on the same strip.
   */
  locale: Locale;
  /**
   * Cells per row on desktop. Left unset it follows the item count up to six, so
   * a four-KPI module gets four full-width cells rather than four cells and a gap
   * — a part-filled row is fine when a strip genuinely has more items than fit,
   * and merely looks unfinished when it does not.
   */
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  if (items.length === 0) return null;

  const desktop = {
    2: "desktop:grid-cols-2",
    3: "desktop:grid-cols-3",
    4: "desktop:grid-cols-4",
    5: "desktop:grid-cols-5",
    6: "desktop:grid-cols-6",
  }[columns ?? (Math.min(Math.max(items.length, 2), 6) as 2 | 3 | 4 | 5 | 6)];

  return (
    <div
      data-testid="kpi-strip"
      className={cn("overflow-hidden rounded-md border bg-surface shadow-card", className)}
    >
      {title || toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-sm border-b bg-surface-2/30 px-md py-2.5">
          {title ? <h2 className="min-w-0 truncate text-body-lg font-medium text-fg">{title}</h2> : <span />}
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        </div>
      ) : null}
      <div className={cn("-mb-px -me-px grid grid-cols-2 tablet:grid-cols-3", desktop)}>
        {items.map((item) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-label text-fg-secondary">{item.label}</span>
                {/* 2.25rem and `rounded-md`, up from a 2rem square: the tile is
                    the cell's one piece of colour, and at 32px with a 17px glyph
                    it read as an afterthought pinned to the corner rather than
                    as the tile the reference draws. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-md",
                    kpiChip[item.tone ?? "neutral"],
                  )}
                >
                  <item.Icon size={18} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                {/* NOT `truncate`, and this is a correctness rule rather than a
                    layout preference: truncating a number does not look
                    truncated, it looks like a SMALLER NUMBER. "EGP 289,600.00"
                    clipped mid-string reads as a perfectly plausible figure
                    that happens to be wrong. Wrapping is ugly at worst; the
                    real fix is on the caller, which should pass money to a KPI
                    in the compact format (see `formatCompactMoney`). */}
                <span className="min-w-0 break-words font-display text-headline leading-tight text-fg tabular-nums">
                  {typeof item.value === "number" ? formatNumber(item.value, locale) : item.value}
                </span>
                {item.unit ? (
                  <span className="shrink-0 text-label text-fg-muted">{item.unit}</span>
                ) : null}
              </div>
              {/* The delta REPLACES the foot line rather than stacking under
                  it. Both answer "what does this number mean", and a cell
                  carrying a measured movement AND a line of static context is a
                  cell whose fourth row nobody reads — while the ragged heights
                  it produces across a five-cell strip cost more than the line
                  was worth. Where a delta exists it is the better answer. */}
              {item.delta ? (
                <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-label">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums",
                      item.delta.better === true && "text-success",
                      item.delta.better === false && "text-danger",
                      item.delta.better === null && "text-fg-secondary",
                    )}
                  >
                    {/* The arrow is the SIGN, drawn as a glyph so the direction
                        survives greyscale and colour-vision deficiency — the
                        colour beside it carries "good or bad", which is a
                        different question and not one an arrow can answer. */}
                    <span aria-hidden="true">{item.delta.pct >= 0 ? "↑" : "↓"}</span>
                    {/* `formatPercent`, not a formatted number with a literal
                        "%" after it: Arabic writes the sign as ٪ and puts it on
                        the correct side of the digits, and hand-appending "%"
                        is how "١٨%" — half Arabic, half Latin — gets shipped. */}
                    {formatPercent(Math.abs(item.delta.pct), locale)}
                  </span>
                  <span className="min-w-0 text-fg-muted">{item.delta.label}</span>
                </p>
              ) : item.foot ? (
                // Two lines, then clip. One line truncated at "Confirmed and
                // in-progress o…" tells the reader nothing they did not already
                // know from the label above it.
                <p className="mt-2 line-clamp-2 text-label text-fg-muted">{item.foot}</p>
              ) : null}
            </>
          );
          const shell = "flex min-w-0 flex-col border-b border-e px-md py-4";
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                shell,
                "transition-colors hover:bg-surface-2/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
              )}
            >
              {body}
            </Link>
          ) : (
            <div key={item.label} className={shell}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * A working pane: the wide column that holds the real list, and a narrow column
 * beside it that holds context about that list.
 *
 * The aside is not a sidebar and must not hold navigation or controls the main
 * column depends on — below `desktop` it stacks UNDER the main column, and
 * anything essential would disappear below the fold on a tablet. What belongs
 * there is what the reference puts there: a breakdown of what the list contains,
 * a short ranking, a recent-activity list. Read-only context.
 */
export function WorkPane({
  children,
  aside,
  /** `wide` gives the aside more room — right for a breakdown with figures. */
  asideWidth = "narrow",
}: {
  children: ReactNode;
  aside?: ReactNode;
  asideWidth?: "narrow" | "wide";
}) {
  if (!aside) return <div className="flex min-w-0 flex-col gap-md">{children}</div>;
  return (
    <div
      className={cn(
        "grid gap-lg [&>*]:min-w-0",
        asideWidth === "wide" ? "desktop:grid-cols-[1fr_22rem]" : "desktop:grid-cols-[1fr_18rem]",
      )}
    >
      <div className="flex min-w-0 flex-col gap-md">{children}</div>
      <aside className="flex min-w-0 flex-col gap-md">{aside}</aside>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

/* The two halves of a toned panel header, kept as full static class strings
   because Tailwind scans SOURCE TEXT: an interpolated `bg-${tone}/8` is a class
   that exists in the markup and in no stylesheet, which fails silently and looks
   exactly like a colour that "did not work". */
const panelHeader: Record<KpiTone, string> = {
  neutral: "bg-surface-2/40",
  accent: "bg-accent-solid/10",
  iris: "bg-iris-solid/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
  danger: "bg-danger/10",
  info: "bg-info/10",
};

const panelGlyph: Record<KpiTone, string> = {
  neutral: "text-fg-muted",
  accent: "text-accent",
  iris: "text-iris",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

/**
 * A compact panel: header rule, title, optional trailing link, then content.
 * Tighter than `Card` on purpose — this is the unit the aside column and the
 * reference's dense sub-sections are built from.
 */
export function Panel({
  title,
  Icon,
  action,
  badge,
  children,
  className,
  hint,
  fill,
  foot,
  tone,
  bodyClassName,
}: {
  title: string;
  Icon?: ComponentType<{ size?: number }>;
  action?: ReactNode;
  /** A count or state marker rendered beside the title, inside the header rule. */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: string;
  /**
   * Colours the header band and its glyph.
   *
   * Unset, the header keeps the neutral `surface-2` wash every module page
   * already draws — this is not a restyling of the workspace. Set, it gives a
   * dashboard row what the reference gives it: a thin band of the panel's own
   * subject colour, so a page of eight panels reads as eight distinct
   * instruments rather than eight identical beige cards. The wash is deliberately
   * weak (6–8%) — it is a label, and a header that competes with its own content
   * is a header that has stopped being one.
   */
  tone?: KpiTone;
  /** Escape hatch for a body that manages its own padding (a flush list). */
  bodyClassName?: string;
  /**
   * Stretch to the height of the tallest panel in the row.
   *
   * Opt-in rather than automatic, because it is only ever right inside a GRID
   * row — a panel in a normal flex stack that grows to fill would take the whole
   * column. Where it is on, a short panel beside a tall one gains the difference
   * as breathing room at its foot instead of leaving a ragged step between two
   * cards that clearly belong to the same row.
   */
  fill?: boolean;
  /** A closing line under the body, separated by a rule — a total, a caveat. */
  foot?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border bg-surface shadow-card",
        fill && "flex h-full flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-sm border-b px-md py-2.5",
          tone ? panelHeader[tone] : "bg-surface-2/40",
        )}
      >
        <h2 className="flex min-w-0 items-center gap-2 text-body-lg font-medium text-fg">
          {Icon ? (
            <span className={cn("shrink-0", tone ? panelGlyph[tone] : "text-fg-muted")} aria-hidden="true">
              <Icon size={17} />
            </span>
          ) : null}
          <span className="truncate">{title}</span>
          {badge ? <span className="shrink-0">{badge}</span> : null}
        </h2>
        {action ? <div className="shrink-0 text-label">{action}</div> : null}
      </div>
      <div className={cn("px-md py-md", fill && "flex-1", bodyClassName)}>
        {hint ? <p className="mb-sm text-label text-fg-muted">{hint}</p> : null}
        {children}
      </div>
      {foot ? (
        <div className="border-t bg-surface-2/30 px-md py-2 text-label text-fg-muted">{foot}</div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * A row of panels that sit SIDE BY SIDE and end level with each other.
 *
 * WHY THIS AND NOT `WorkPane`
 * `WorkPane` is a wide working column with a permanently narrow context rail
 * beside it, and it is right for a MODULE page, where one list is the subject
 * and everything else annotates it. A dashboard is not that shape: it is a
 * sequence of rows in which the two or three blocks are peers of different
 * weight, and the reference builds every screen out of exactly those rows. Used
 * on a dashboard, `WorkPane` produced the failure this replaces — an 18rem rail
 * holding 300px of content beside an 800px column, so roughly a quarter of the
 * page width was blank from the rail's last panel down to the row's foot.
 *
 * `cols` describes PROPORTION, never pixels. A fixed `22rem` aside is dead space
 * at 2560px and a squeeze at 1280px; fractional tracks give the operational
 * block the extra room a wide display offers and hand it back on a laptop, which
 * is what "use the width, do not stretch the small cards" actually requires.
 *
 * Every variant collapses to one column below its own breakpoint, so nothing
 * here can produce horizontal overflow.
 */
export type RowCols = "lead" | "wide-lead" | "even" | "thirds";

const rowCols: Record<RowCols, string> = {
  /* Operational block roughly 3:2 against its context panel. The workhorse. */
  lead: "desktop:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]",
  /* The same idea for a row whose lead block is a dense queue or a chart that
     genuinely wants the room — it stays stacked until `desktop` and only opens
     to its full 5:2 at `wide`, so a 1280px laptop does not get a 340px column. */
  "wide-lead": "desktop:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] wide:grid-cols-[minmax(0,2.5fr)_minmax(0,1fr)]",
  /* Two peers — two record lists, or a chart and its breakdown. */
  even: "desktop:grid-cols-2",
  /* Three summaries. Two-up on a tablet first, because three 250px cards on a
     768px screen is not a summary, it is a set of truncated labels. */
  thirds: "tablet:grid-cols-2 desktop:grid-cols-3",
};

export function Row({
  cols,
  children,
  className,
}: {
  cols: RowCols;
  children: ReactNode;
  className?: string;
}) {
  return (
    // `items-stretch` is the grid default and is what makes `Panel fill` work;
    // it is named here so that a later `items-start` cannot be added by accident
    // without someone noticing it breaks the row's level foot.
    <div className={cn("grid items-stretch gap-md [&>*]:min-w-0", rowCols[cols], className)}>
      {children}
    </div>
  );
}

/**
 * A key/value line for a summary panel: a tone dot, a label, and the figure.
 * With `share` it also carries a proportion bar, which is what turns a list of
 * counts into a readable breakdown.
 */
export function PanelRow({
  label,
  value,
  locale,
  tone,
  href,
  share,
}: {
  label: string;
  /** A number is formatted for `locale`; anything else renders as given. */
  value: ReactNode;
  locale: Locale;
  tone?: KpiTone;
  href?: string;
  /**
   * This row's fraction of its group, 0–1 — draws a proportion bar under the
   * label line.
   *
   * Opt-in, because it is only meaningful where the rows of a panel are PARTS OF
   * ONE WHOLE (statuses of a stage), and actively misleading where they are not
   * (a total beside an average). Where it is on, it also does real layout work:
   * a bare label/value pair in a 400px column is two words separated by 300px of
   * nothing, and the bar is what turns that gap into the comparison the reader
   * was making anyway.
   */
  share?: number;
}) {
  const dot = tone ? (
    <span
      aria-hidden="true"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-pill",
        tone === "danger" && "bg-danger",
        tone === "warning" && "bg-warning",
        tone === "success" && "bg-success",
        tone === "info" && "bg-info",
        tone === "accent" && "bg-accent-solid",
        tone === "neutral" && "bg-fg-muted",
      )}
    />
  ) : null;

  const line = (
    <span className="flex items-center justify-between gap-sm">
      <span className="flex min-w-0 items-center gap-2 text-body text-fg-secondary">
        {dot}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-body font-medium tabular-nums text-fg">
        {typeof value === "number" ? formatNumber(value, locale) : value}
      </span>
    </span>
  );

  const body =
    typeof share === "number" ? (
      <span className="flex min-w-0 flex-col gap-0.5">
        {line}
        {/* Track and fill, not a fill alone: without the track a row at 8% is a
            stub floating in white space and reads as a rendering fault rather
            than a small number. `rounded-pill` on both keeps the cap shape at
            every width, including the near-zero one. */}
        <span aria-hidden="true" className="block h-1 w-full rounded-pill bg-surface-2">
          <span
            className={cn(
              "block h-full rounded-pill",
              tone === "danger" && "bg-danger",
              tone === "warning" && "bg-warning",
              tone === "success" && "bg-success",
              tone === "info" && "bg-info",
              tone === "accent" && "bg-accent-solid",
              (tone === "neutral" || !tone) && "bg-fg-muted",
            )}
            /* A percentage width is the one thing here that cannot be a utility
               class: it is data. Floored at 2% so a present-but-tiny value still
               shows an edge, and clamped at 100 so a bad share cannot overflow
               its track. */
            style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%` }}
          />
        </span>
      </span>
    ) : (
      line
    );

  /* A row carrying a bar is two stacked lines, so it needs LESS padding than a
     bare one to keep the same rhythm — without this the bar variant runs a third
     taller and a summary panel built from it outgrows the operational block it
     is meant to support. */
  const pad = typeof share === "number" ? "py-1" : "py-1.5";

  return href ? (
    <Link
      href={href}
      className={cn(
        "-mx-1 flex flex-col rounded-xs px-1 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        pad,
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cn("flex flex-col", pad)}>{body}</div>
  );
}

/* ------------------------------------------------------------------------- */

export type NextStep = {
  title: string;
  body: string;
  href: string;
  cta: string;
  Icon: ComponentType<{ size?: number }>;
  tone?: KpiTone;
};

/**
 * The foot-of-page action row.
 *
 * The reference closes several screens with three or four "what to do next"
 * cards, and it is a genuinely good pattern for an operational workspace: the
 * page has just told the user what the state is, and this says what they can do
 * about it. The rule that keeps it honest is that every card must point at a
 * route that EXISTS and an action the caller can actually take — a card is
 * passed in by the page, which already knows the caller's capabilities, rather
 * than being a fixed list this component decides.
 */
export function NextSteps({ steps, label }: { steps: NextStep[]; label: string }) {
  if (steps.length === 0) return null;
  return (
    <section aria-label={label} className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3 [&>*]:min-w-0">
      {steps.map((step) => (
        <Link
          key={step.href + step.title}
          href={step.href}
          className={cn(
            "group flex min-w-0 flex-col gap-1.5 rounded-md border bg-surface p-md shadow-card",
            "transition-colors hover:border-strong hover:bg-surface-2/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <span
            aria-hidden="true"
            className={cn("grid h-9 w-9 place-items-center rounded-sm", kpiChip[step.tone ?? "accent"])}
          >
            <step.Icon size={18} />
          </span>
          <span className="text-body-lg font-medium text-fg">{step.title}</span>
          <span className="text-label text-fg-secondary">{step.body}</span>
          <span className="mt-auto pt-1.5 text-label font-medium text-accent group-hover:underline">
            {step.cta} →
          </span>
        </Link>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * A section rule with a heading — what separates the bands of a dense page.
 * Lighter than a `Card`, because the bands below it already carry their own
 * surfaces and nesting a card inside a card is how a dense page turns to mush.
 */
export function Band({
  title,
  Icon,
  action,
  children,
}: {
  title: string;
  Icon?: ComponentType<{ size?: number }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-md">
      <div className="flex items-center justify-between gap-md">
        <h2 className="flex min-w-0 items-center gap-2 text-title text-fg">
          {Icon ? (
            <span className="shrink-0 text-accent" aria-hidden="true">
              <Icon size={18} />
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * The page header every workspace module opens with.
 *
 * It is now a thin adapter over the shared `PageHead` band rather than its own
 * layout. That is the point: before, this file drew one header and the newer
 * dense surfaces drew another, and two headers is exactly how a workspace starts
 * looking like two products. Callers keep the props they had — `title`,
 * `subtitle`, `count`, `action` — and gain the band's icon tile, eyebrow line
 * and secondary toolbar slot without changing a line.
 *
 * `action` stays a `{href,label}` pair rather than a node so that every module's
 * primary action renders identically (leading +, accent fill), which is what
 * lets a user learn the button once.
 */
export function PageHeader({
  title,
  subtitle,
  count,
  locale,
  action,
  Icon,
  eyebrow,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  /** Result/record count shown as a subtle pill beside the title. */
  count?: number;
  /** Required for the same reason `PageHead` requires it. */
  locale: Locale;
  action?: { href: string; label: string };
  /** The module's own glyph — the same one the sidebar draws for this route. */
  Icon?: ComponentType<{ size?: number }>;
  eyebrow?: string;
  /** Secondary page-level controls (a link out, a help affordance). */
  toolbar?: ReactNode;
}) {
  return (
    <PageHead
      title={title}
      subtitle={subtitle}
      count={count}
      locale={locale}
      Icon={Icon}
      eyebrow={eyebrow}
      toolbar={toolbar}
      actions={
        action ? (
          /* THE CANONICAL BUTTON, NOT A HAND-STYLED LINK.
             This used to carry its own fill, padding, radius, shadow, focus ring
             and hover — a second primary-button treatment living inside the
             FOUNDATION, which is the worst possible place for one: every module
             inherits it, so the divergence was invisible page by page and total
             across the app. It now renders the shared `Button` in its `accent`
             variant wrapped in `Link` — the same pattern the profile hub already
             uses — so the primary action has exactly one definition. No consumer
             page changed; they all pass the same `{href,label}` they did. */
          <Link href={action.href} className="shrink-0">
            <Button type="button" variant="accent" size="sm">
              <PlusIcon size={16} />
              {action.label}
            </Button>
          </Link>
        ) : undefined
      }
    />
  );
}
