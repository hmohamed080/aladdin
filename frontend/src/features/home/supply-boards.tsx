import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ProductMedia } from "@/features/commerce/product-media";
import { ChevronRightIcon, PlayIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/* ------------------------------------------------------------------ *
 * Header toggle chip
 * ------------------------------------------------------------------ */

/**
 * A single on/off filter chip for a board's header — "Due date" and "Today"
 * both are one of these, differing only in the query param each toggles.
 *
 * A plain `<Link>`, not a client control: the same reasoning `AttentionFilter`
 * gives for its own chips applies here — this is a server navigation, and
 * hiding that behind a client-side toggle would only disguise the latency,
 * not remove it. No chevron: unlike `StageSelect`, this does not open
 * anything, and drawing one would promise a menu that never appears.
 */
export function HeaderToggle({
  Icon,
  label,
  active,
  href,
}: {
  Icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-label font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        active
          ? "border-accent-solid/40 bg-accent-solid/10 text-accent"
          : "border-workspace-line bg-surface text-fg-secondary shadow-sm hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Icon size={14} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The Supplier Dashboard's own presentation layer.
 *
 * WHY A SEPARATE MODULE, AND WHY NOT `Panel` / `KpiStrip`
 * The shared workspace primitives are correct and stay correct — every other
 * route keeps using them. They encode a different composition from the one this
 * page is now supposed to have: `Panel` offers a TINTED HEADER BAND to signal a
 * panel's subject, `KpiStrip` gives each metric a card of its own, and the two
 * together produce a page of independent coloured cards with no ranking between
 * them. That is precisely the appearance the approved concept replaces.
 *
 * So this file holds the boards THIS page is composed from: one neutral panel
 * shape, one continuous metric region, an operational row list with material
 * imagery, and three reference modules. It is a presentation layer over data
 * fetched exactly as before — no component here queries anything, and every
 * board takes finished, localized strings, so the file contains no copy and no
 * locale logic.
 *
 * WHAT IT DELIBERATELY IS NOT: a second design system. Every colour, radius,
 * shadow and type step below is an existing token. Nothing here introduces a
 * value; it only arranges them differently from the way the shared primitives do.
 */

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

/**
 * One board: a white surface on the tinted body, with a quiet header.
 *
 * NEUTRAL BY CONSTRUCTION. There is no `tone` prop and there must not be one.
 * A tinted header is a per-panel decision, and per-panel decisions are how a
 * dashboard ends up with six differently-coloured cards, each shouting, none
 * ranking. Rank on this page comes from SIZE and POSITION — the attention board
 * is wide and first, the reference modules are a third as wide and last — which
 * is a hierarchy the reader can see without having to learn what red means.
 *
 * The subject is carried by the header icon, which is the one accented mark a
 * board gets.
 */
export function Board({
  title,
  Icon,
  badge,
  controls,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  Icon?: ComponentType<{ size?: number; className?: string }>;
  /** A count beside the title — how much work this board is holding. */
  badge?: ReactNode;
  /** Filters and menus, hard against the trailing edge of the header. */
  controls?: ReactNode;
  /** The way out to the module that owns these records. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-workspace-line bg-surface",
        // A shadow this light is almost not a shadow, and that is the intent: the
        // board is already separated from the body by being lighter than it, so
        // the shadow only has to stop the edge from looking drawn-on. The heavy
        // `shadow-card` here made six cards look like six floating tiles.
        "shadow-sm",
        className,
      )}
    >
      <header className="flex min-w-0 items-center gap-2.5 px-4 py-3 tablet:px-5">
        {Icon ? (
          <span aria-hidden="true" className="shrink-0 text-info">
            <Icon size={18} />
          </span>
        ) : null}
        <h2 className="truncate text-body-lg font-semibold text-fg">{title}</h2>
        {badge}
        {controls ? (
          <div className="ms-auto flex shrink-0 items-center gap-2">{controls}</div>
        ) : null}
      </header>

      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>

      {footer ? (
        <div className="border-t border-workspace-line px-4 py-2.5 tablet:px-5">{footer}</div>
      ) : null}
    </section>
  );
}

/** The count chip beside a board title. Neutral — the number is the message. */
export function BoardCount({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-caption font-semibold tabular-nums text-fg-secondary">
      {children}
    </span>
  );
}

/**
 * The "go to the module that owns this" link every board carries, drawn as the
 * reference draws it: the label at the leading edge, the arrow pushed hard to
 * the trailing edge, the whole width a target.
 */
export function BoardOut({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 text-label font-semibold text-fg transition-colors hover:text-info"
    >
      <span className="truncate">{label}</span>
      <span
        aria-hidden="true"
        className="ms-auto shrink-0 text-fg-muted transition-colors group-hover:text-info"
      >
        {/* Logical, not physical: `rtl:-scale-x-100` turns the arrow round in
            Arabic, where "onward" is leftward. An arrow glyph chosen per locale
            would be two glyphs to keep in step. */}
        <span className="inline-block rtl:-scale-x-100">→</span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * The page head
 * ------------------------------------------------------------------ */

/**
 * The heading band: what this page is, one line on what it is for, and the two
 * actions that belong to it.
 *
 * No eyebrow and no icon tile. Both were dropped deliberately. The eyebrow
 * repeated the organization name that the header card and the sidebar's
 * workspace card BOTH already carry — three times on one screen — and the tile
 * was a decorative glyph occupying the position the eye lands on first, where
 * the title should be.
 */
export function DashboardHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-headline leading-tight text-fg">{title}</h1>
        <p className="mt-1 text-body text-fg-secondary">{subtitle}</p>
      </div>
      {/* `flex-wrap`, and it is a correctness fix rather than a nicety: three
          controls at their natural width are ~430px, so on a 390px phone the
          third one ran off the side of the document and gave the whole page a
          horizontal scrollbar — which the visual-QA matrix asserts against, and
          which no amount of vertical polish makes acceptable. */}
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 tablet:w-auto tablet:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** The page's one primary action: solid, and the only solid button on the page. */
export function PrimaryAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // THE SHELL'S NAVY, not the brand amber. On this page the amber is spent
        // on the mark at the top of the sidebar and on nothing else; a second
        // amber block at the opposite corner of the screen pulled the eye
        // straight past the heading it is supposed to sit beside. Navy also ties
        // the action to the chrome it belongs to, which is what the reference
        // does.
        "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-shell px-4 text-label font-semibold text-shell-fg",
        "shadow-sm transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-workspace",
      )}
    >
      {children}
    </Link>
  );
}

/** The secondary action: the same shape, outlined, so the pair reads as a pair. */
export function SecondaryAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-workspace-line bg-surface px-4 text-label font-semibold text-fg",
        "shadow-sm transition-colors hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-workspace",
      )}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * The metric strip
 * ------------------------------------------------------------------ */

export type MetricTone = "info" | "accent" | "success" | "danger" | "iris" | "neutral";

/**
 * The soft chip behind a metric's icon.
 *
 * Tone here is CATEGORICAL, not evaluative — it says which part of the business
 * a figure belongs to, so the five chips read as a set rather than as five
 * verdicts. Whether a number is good or bad is answered one line below, by the
 * delta, which is the only place on this strip that colour means judgement.
 */
const CHIP: Record<MetricTone, string> = {
  info: "bg-info/15 text-info",
  accent: "bg-accent-solid/20 text-bronze",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  iris: "bg-iris-solid/15 text-iris",
  neutral: "bg-surface-2 text-fg-secondary",
};

export type Metric = {
  key: string;
  label: string;
  /** Already formatted in the reader's locale — this file does no number work. */
  value: string;
  /** The unit word that follows the figure: "requests", "orders", "median". */
  unit?: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  tone: MetricTone;
  /**
   * A measured movement against the previous window, or nothing at all. Absent
   * whenever there is no real non-zero baseline to compare against — see the
   * dashboard's own `movement()`. A first month of trading has no percentage.
   */
  delta?: { text: string; better: boolean | null; label: string };
  /** Shown INSTEAD of a delta: what this figure is, when it cannot move. */
  foot?: string;
  /** Whether the foot line is a warning rather than a note. */
  footTone?: "muted" | "warning";
  href?: string;
};

/**
 * The instrument panel: one region, five or six metrics, hairlines between them.
 *
 * ONE PANEL, NOT SIX CARDS, and the difference is the whole point of the
 * rebuild. Six bordered cards with their own shadows are six objects, and the
 * eye counts objects before it reads any of them; a single panel divided by
 * hairlines is one object with five readings in it, which is what an instrument
 * panel actually is. It also buys back the ~90px of vertical space the card gaps
 * and borders were spending, which is why the attention board now starts above
 * the fold.
 */
export function MetricStrip({ items }: { items: Metric[] }) {
  if (items.length === 0) return null;
  return (
    <section
      className={cn(
        "grid overflow-hidden rounded-2xl border border-workspace-line bg-surface shadow-sm",
        // Two up on a phone, three at tablet, all of them in one row from
        // `wide`. `divide` draws the hairlines between cells without a border on
        // the outer edges, which is what keeps this reading as one panel.
        "grid-cols-2 divide-x divide-y divide-workspace-line",
        "tablet:grid-cols-3 tablet:divide-y-0",
        items.length >= 6 ? "wide:grid-cols-6" : "wide:grid-cols-5",
      )}
    >
      {items.map((m) => {
        const inner = (
          <>
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-[0.625rem]",
                  CHIP[m.tone],
                )}
              >
                <m.Icon size={17} />
              </span>
              <div className="min-w-0 pt-0.5">
                {/* Wraps to two lines rather than truncating. These labels are
                    real sentences of product copy in two languages — "Requests to
                    answer", "طلبات في انتظار الرد" — and none of the five is
                    guaranteed to fit one line of a fifth of the strip. A wrapped
                    label costs a row of height once; a truncated one costs the
                    reader the metric's name every time they look. */}
                <p className="text-label font-semibold leading-snug text-fg">{m.label}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                  {/* The figure carries the hierarchy. `tabular-nums` so a strip
                      of five numbers has a straight left edge; `tracking-tight`
                      because at this weight and size the default tracking makes
                      a four-character money figure look loose. */}
                  <span className="text-[1.5rem] font-bold leading-none tracking-tight tabular-nums text-fg">
                    {m.value}
                  </span>
                  {m.unit ? (
                    <span className="text-caption text-fg-muted">{m.unit}</span>
                  ) : null}
                </p>
              </div>
            </div>

            <p className="mt-2.5 flex min-w-0 flex-wrap items-start gap-x-1.5 text-[0.6875rem] leading-snug">
              {m.delta ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "shrink-0 text-[0.625rem] leading-none",
                      m.delta.better === false ? "text-danger" : "text-info",
                    )}
                  >
                    {m.delta.better === false ? "▼" : "▲"}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      m.delta.better === false ? "text-danger" : "text-info",
                    )}
                  >
                    {m.delta.text}
                  </span>
                  {/* Not `truncate`. "from last month" losing its last word to
                      an ellipsis leaves "from last mo…", which is not a shorter
                      caption — it is a caption the reader has to reconstruct.
                      The line wraps instead; the cell has the height. */}
                  <span className="text-fg-muted">{m.delta.label}</span>
                </>
              ) : m.foot ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      m.footTone === "warning" ? "bg-warning" : "bg-fg-muted/50",
                    )}
                  />
                  <span className="line-clamp-2 text-fg-secondary">{m.foot}</span>
                </>
              ) : null}
            </p>
          </>
        );

        return m.href ? (
          <Link
            key={m.key}
            href={m.href}
            className="group min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus tablet:px-5"
          >
            {inner}
          </Link>
        ) : (
          <div key={m.key} className="min-w-0 px-4 py-3.5 tablet:px-5">
            {inner}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Shared row parts
 * ------------------------------------------------------------------ */

/**
 * The material thumbnail.
 *
 * A finishing supplier's work is a catalogue of SURFACES, and a row of names
 * with no picture is a spreadsheet. `ProductMedia` already owns the "no image
 * yet" fallback and the reasons for a plain `<img>`, so this is only the frame:
 * a fixed 44px square that keeps every row on the same rhythm whatever the
 * supplier uploaded.
 */
export function Thumb({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-lg" style={{ width: size, height: size }}>
      <ProductMedia src={src} alt={alt} className="!aspect-square h-full w-full !rounded-lg" />
    </div>
  );
}

/**
 * The status pill's fill.
 *
 * One step HOTTER than the metric chips above, and the difference is deliberate.
 * A chip is 36px square and reads as a filled tile at almost any tint; a pill is
 * 18px tall behind 12px type, and at the chips' strength it rendered as coloured
 * text on nothing — not a pill, just a coloured word, and the row lost the block
 * of colour that lets the eye scan a status column without reading it.
 *
 * EVERY VALUE IS A MULTIPLE OF FIVE, and that is not a style preference: an
 * off-scale modifier compiles to NO RULE at all, silently. This file shipped
 * /12, /16, /18 and /22 tints that were simply absent from the stylesheet, and
 * the symptom — coloured text with no fill — looked exactly like a tint that was
 * merely too weak. See src/styles/opacity-scale.test.ts, which is the only
 * reason it was caught rather than shipped.
 */
const PILL: Record<MetricTone, string> = {
  info: "bg-info/20 text-info",
  accent: "bg-accent-solid/25 text-bronze",
  success: "bg-success/20 text-success",
  danger: "bg-danger/15 text-danger",
  iris: "bg-iris-solid/20 text-iris",
  neutral: "bg-surface-2 text-fg-secondary",
};

/** A record's state, as the reference draws it: soft fill, coloured text. */
export function StatusPill({ tone, children }: { tone: MetricTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-caption font-semibold",
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

/** One labelled figure in a row: the label above, quiet; the value below, not. */
function Field({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-caption text-fg-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-label font-medium",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-bronze" : "text-fg",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The attention board
 * ------------------------------------------------------------------ */

export type AttentionRow = {
  key: string;
  /** Which stage of the pipeline this record is stalled at. */
  stage: string;
  tone: MetricTone;
  title: string;
  /** The business on the other side of it. */
  customer: string;
  /** The catalogue image for the requested material, where one is known. */
  imageRef: string | null;
  dateLabel: string;
  /** Day and month — the row's column has no room for a year. */
  date: string;
  /** The same date in full, for the expanded region, which does have room. */
  dateLong: string;
  /** True when that date has already passed — the row's one urgent mark. */
  overdue?: boolean;
  /** Money or quantity, whichever this stage genuinely has. */
  figureLabel?: string;
  figure?: string;
  status: string;
  href: string;
  cta: string;
  /**
   * The lines the buyer actually asked for, for the lead record's expanded
   * region. Empty for every other row and for records whose lines are not in
   * hand — the region simply carries less.
   */
  lines?: { name: string; quantity: string; imageRef: string | null }[];
};

/**
 * The page's primary workspace: what is stalled, and what to do about it.
 *
 * THE LEAD RECORD IS EXPANDED. The reference opens its first row into a detail
 * region, and it is right to: a triage list whose rows all look equally
 * important is a list the reader has to work down rather than start at. The lead
 * record gets the material photo, the buyer's actual lines and the action, so
 * the most urgent piece of work on the page can be done from the page.
 *
 * It is a `<details>` element, and that is deliberate rather than incidental. It
 * opens and closes with no client JavaScript, it is keyboard-operable and
 * announced correctly for free, and — the part that matters on a dashboard —
 * the closed state is not a second component: the summary IS the compact row,
 * so an expanded lead and a collapsed lead are the same markup in two states
 * rather than two layouts that can drift apart.
 */
export function AttentionBoard({
  rows,
  labels,
  empty,
}: {
  rows: AttentionRow[];
  labels: { requirements: string; buyer: string };
  empty: ReactNode;
}) {
  if (rows.length === 0) return <div className="px-5 pb-6">{empty}</div>;

  const [lead, ...rest] = rows;

  return (
    <div className="flex min-w-0 flex-col">
      <details open className="group/lead border-t border-workspace-line">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-hover tablet:px-5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
            // Safari draws its own disclosure triangle on `summary` unless this
            // pseudo-element is cleared; `list-none` alone does not reach it.
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <RowCore row={lead!} />
          <span
            aria-hidden="true"
            className="shrink-0 text-fg-muted transition-transform group-open/lead:rotate-90 rtl:-scale-x-100 rtl:group-open/lead:-rotate-90"
          >
            <ChevronRightIcon size={16} />
          </span>
        </summary>

        <LeadDetail row={lead!} labels={labels} />
      </details>

      {rest.map((row) => (
        <Link
          key={row.key}
          href={row.href}
          className={cn(
            "flex min-w-0 items-center gap-2.5 border-t border-workspace-line px-4 py-2.5 transition-colors hover:bg-surface-hover tablet:px-5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
          )}
        >
          <RowCore row={row} />
          <span aria-hidden="true" className="shrink-0 text-fg-muted rtl:-scale-x-100">
            <ChevronRightIcon size={16} />
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The part of a row that is identical whether the row is the lead or not.
 *
 * The three data columns collapse below `wide`, leaving name, status and action.
 * That is a real editorial choice rather than a responsive shrug: at ~700px of
 * board the columns had begun truncating dates mid-word, and a date that reads
 * "12 Sep…" is not a shorter date, it is a date the reader cannot use.
 */
function RowCore({ row }: { row: AttentionRow }) {
  return (
    <>
      {/* The stage, and the coloured mark that repeats it without words. The
          reference puts a record IDENTIFIER here; these records have no
          human-readable reference number anywhere in the product, and inventing
          one for a dashboard row would print a code that matches nothing on the
          record it links to. The stage is the true version of the same column. */}
      <span className="hidden w-[5.5rem] shrink-0 items-center gap-1.5 wide:flex">
        <span
          aria-hidden="true"
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            row.tone === "danger"
              ? "bg-danger"
              : row.tone === "accent"
                ? "bg-accent-solid"
                : row.tone === "success"
                  ? "bg-success"
                  : "bg-info",
          )}
        />
        {/* Sentence case, not uppercase. "TO FOLLOW UP" is nine characters
            wider than "To follow up" at the same point size and truncated to
            "TO FO…" in the 76px this column can spare — and a truncated
            all-caps label is unreadable in a way a truncated sentence-case one
            is not, because capitals carry no ascender/descender shape to guess
            from. */}
        <span className="truncate text-caption font-medium text-fg-secondary">{row.stage}</span>
      </span>

      <Thumb src={row.imageRef} alt={row.title} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-semibold text-fg">{row.title}</p>
        <p className="truncate text-caption text-fg-secondary">{row.customer}</p>
      </div>

      <Field
        label={row.dateLabel}
        value={row.date}
        tone={row.overdue ? "danger" : "default"}
        className="hidden w-[5.25rem] shrink-0 wide:block"
      />
      {row.figure ? (
        <Field
          label={row.figureLabel ?? ""}
          value={row.figure}
          className="hidden w-[4.5rem] shrink-0 wide:block"
        />
      ) : (
        <span className="hidden w-[4.5rem] shrink-0 wide:block" />
      )}

      <StatusPill tone={row.tone}>{row.status}</StatusPill>
    </>
  );
}

/**
 * The lead record, opened.
 *
 * WHAT IS HERE AND WHAT IS NOT. The reference fills this region with an AI
 * brief, a stock-coverage figure and a response-time risk. None of those has a
 * model in this repository — there is no stock ledger behind this page, no
 * response-time history, and no brief. They are not stubbed and they are not
 * faked: a dashboard that prints "1.1x coverage" over a number it did not
 * compute is worse than one that omits the panel.
 *
 * What fills the same footprint instead is the thing the reader actually needs
 * and the page already has in hand: the material, the LINES THE BUYER ASKED FOR,
 * who is asking, and the action. That is the same region doing the same job from
 * true data.
 */
function LeadDetail({
  row,
  labels,
}: {
  row: AttentionRow;
  labels: { requirements: string; buyer: string };
}) {
  return (
    <div className="px-4 pb-3 tablet:px-5">
      <div className="flex flex-col gap-4 rounded-xl border border-workspace-line bg-workspace/60 p-3.5 tablet:flex-row">
        <div className="shrink-0">
          <Thumb src={row.imageRef} alt={row.title} size={112} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="text-label font-semibold text-fg">{labels.buyer}</p>
            <p className="mt-1 text-body font-medium text-fg">{row.customer}</p>
            <p className="mt-0.5 text-caption text-fg-secondary">
              {row.dateLabel} · {row.dateLong}
            </p>
          </div>

          <Link
            href={row.href}
            className={cn(
              "inline-flex min-h-9 w-fit items-center gap-2 rounded-lg bg-shell px-3.5 text-label font-semibold text-shell-fg",
              "transition-opacity hover:opacity-90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-workspace",
            )}
          >
            {row.cta}
          </Link>
        </div>

        {row.lines && row.lines.length > 0 ? (
          <div className="min-w-0 flex-1 border-t border-workspace-line pt-3 tablet:border-s tablet:border-t-0 tablet:ps-4 tablet:pt-0">
            <p className="text-label font-semibold text-fg">{labels.requirements}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {row.lines.slice(0, 4).map((line, i) => (
                <li key={i} className="flex min-w-0 items-baseline gap-2 text-label">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-muted/60"
                  />
                  <span className="min-w-0 flex-1 truncate text-fg">{line.name}</span>
                  <span className="shrink-0 tabular-nums text-fg-secondary">{line.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Incoming demand
 * ------------------------------------------------------------------ */

export type IncomingRow = {
  key: string;
  productName: string;
  buyer: string;
  /** The request this line sits on, and how long ago it arrived. */
  meta: string;
  imageRef: string | null;
  href: string;
  /** Unread-style mark: this line has not been priced. */
  open: boolean;
};

/**
 * The secondary rail: what has just arrived, in arrival order.
 *
 * LIGHTER THAN THE BOARD BESIDE IT, ON PURPOSE. Three lines and a picture, no
 * columns, no status pills, no actions. It answers "what is coming in" and hands
 * off; the deciding happens in the attention board to its leading side, and a
 * rail with its own buttons would compete with it for the same attention.
 */
export function IncomingRail({ rows, empty }: { rows: IncomingRow[]; empty: ReactNode }) {
  if (rows.length === 0) return <div className="px-5 pb-6">{empty}</div>;
  return (
    <div className="flex flex-col">
      {rows.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          className={cn(
            "flex min-w-0 items-center gap-3 border-t border-workspace-line px-4 py-2.5 transition-colors hover:bg-surface-hover tablet:px-5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
          )}
        >
          <Thumb src={r.imageRef} alt={r.productName} size={46} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label font-semibold text-fg">{r.productName}</p>
            <p className="truncate text-caption text-fg-secondary">{r.buyer}</p>
            <p className="truncate text-caption text-fg-muted">{r.meta}</p>
          </div>
          {r.open ? (
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-info"
            />
          ) : null}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The lower reference modules
 * ------------------------------------------------------------------ */

export type MovingRow = {
  name: string;
  /** Requests naming this product inside the window, already formatted. */
  requests: string;
  /** Its share of the busiest row, 0-1, for the bar. */
  share: number;
  /** Movement against the previous window, already formatted, or null. */
  change: string | null;
  changeBetter: boolean | null;
};

/**
 * What is being asked for, ranked.
 *
 * The bar is measured against the BUSIEST ROW rather than against the total,
 * which is the only scaling that stays readable at five rows: shares of a total
 * across five products are all short bars that differ by a few pixels, and a bar
 * nobody can compare is decoration.
 */
export function MovingBoard({
  rows,
  labels,
  empty,
}: {
  rows: MovingRow[];
  labels: { requests: string };
  empty: ReactNode;
}) {
  if (rows.length === 0) return <div className="px-5 pb-6">{empty}</div>;
  return (
    <div className="px-4 pb-4 tablet:px-5">
      <div className="flex items-center gap-3 border-t border-workspace-line py-2 text-caption text-fg-muted">
        <span className="min-w-0 flex-1" />
        <span className="w-16 shrink-0 text-end">{labels.requests}</span>
        {/* The movement column is deliberately unlabelled. Every honest heading
            for it — "change", "vs. the previous 90 days" — is longer than the
            56px the column can spare and truncates to nonsense, and the cell
            below already says what it is twice over: a signed percentage with a
            direction arrow, coloured. A header here would add a word and remove
            a date. */}
        <span className="w-14 shrink-0" />
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-label font-medium text-fg">{r.name}</p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-info"
                  style={{ width: `${Math.max(4, Math.round(r.share * 100))}%` }}
                />
              </div>
            </div>
            <span className="w-16 shrink-0 text-end text-label tabular-nums text-fg-secondary">
              {r.requests}
            </span>
            <span
              className={cn(
                "w-14 shrink-0 text-end text-label font-semibold tabular-nums",
                r.change === null
                  ? "text-fg-muted"
                  : r.changeBetter === false
                    ? "text-danger"
                    : "text-info",
              )}
            >
              {r.change ?? "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type ActivityRow = {
  key: string;
  title: string;
  timeAgo: string;
  timestamp: string;
  href: string | null;
  unread: boolean;
};

/** What has happened, newest first. The feed the reference calls latest activity. */
export function ActivityBoard({ rows, empty }: { rows: ActivityRow[]; empty: ReactNode }) {
  if (rows.length === 0) return <div className="px-5 pb-6">{empty}</div>;
  return (
    <ul className="flex flex-col px-4 pb-2 tablet:px-5">
      {rows.map((r) => {
        const inner = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                r.unread ? "bg-info" : "bg-fg-muted/40",
              )}
            />
            <span className="min-w-0 flex-1 text-label text-fg">{r.title}</span>
            <time
              dateTime={r.timestamp}
              className="shrink-0 text-caption tabular-nums text-fg-muted"
            >
              {r.timeAgo}
            </time>
          </>
        );
        return (
          <li key={r.key} className="border-t border-workspace-line first:border-t-0">
            {r.href ? (
              <Link
                href={r.href}
                className="flex items-start gap-2.5 py-2.5 transition-colors hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
              >
                {inner}
              </Link>
            ) : (
              <div className="flex items-start gap-2.5 py-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type PipelineStage = {
  key: string;
  label: string;
  value: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  href: string;
};

/**
 * The commerce lifecycle as a track: five stages, left to right, with the count
 * standing under each.
 *
 * A TRACK RATHER THAN FIVE TILES, because the stages are sequential and the
 * shape should say so — a request becomes a quotation becomes an order, and five
 * boxes in a row say only that there are five of something. The connecting rule
 * runs BEHIND the nodes at `z-0`, so it never crosses a glyph.
 */
export function PipelineTrack({ stages }: { stages: PipelineStage[] }) {
  if (stages.length === 0) return null;
  return (
    <div className="relative px-4 pb-4 pt-1 tablet:px-5">
      <ol className="relative flex items-start justify-between gap-1">
        {/* The rule. Inset by half a node on each side so it starts and ends AT
            the first and last nodes rather than floating past them. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-[10%] top-[13px] z-0 h-px bg-workspace-line"
        />
        {stages.map((s) => (
          <li key={s.key} className="relative z-10 flex min-w-0 flex-1 flex-col items-center">
            {/* `w-full` is what stops the labels colliding. Without it the
                anchor is sized by its widest child — the LABEL — so a
                "Prices accepted" simply grew past its column and overlapped its
                neighbours; the `truncate` below could never fire, because there
                was no constrained width for it to truncate against. */}
            <Link
              href={s.href}
              className="group flex w-full min-w-0 flex-col items-center gap-1.5 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-full border border-workspace-line bg-surface text-fg-muted transition-colors group-hover:border-info group-hover:text-info group-focus-visible:ring-2 group-focus-visible:ring-focus"
              >
                <s.Icon size={14} />
              </span>
              <span className="text-label font-bold tabular-nums text-fg">{s.value}</span>
              {/* Two lines, then clamp. A stage name is two or three words in
                  both languages and there are five of them across a third of the
                  page; one line means every one of them truncates, and a
                  pipeline whose stages cannot be named is a row of numbers. */}
              <span className="line-clamp-2 w-full text-center text-caption leading-tight text-fg-muted">
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Product videos (Reels) — DESIGN-LAB PROTOTYPE, see `app/b2b/layout.tsx`
 * ------------------------------------------------------------------ */

export type ReelItem = {
  id: string;
  /** The product's real name and photo — nothing here is a placeholder. */
  title: string;
  imageRef: string | null;
  href: string;
};

/**
 * A stable, PLAINLY DECORATIVE figure derived from the record's own id — not
 * a random number (which would reshuffle every render/reload and look like a
 * flaky metric) and not a real count (there is no video/view/like model
 * behind this prototype; see the module doc). Same id, same figure, every
 * time, which is what keeps it from reading as live data it is not.
 */
function decorativeFigure(id: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return min + (h % (max - min + 1));
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * One card: the product's own photo standing in for a video frame, a
 * centred play control, a duration badge, and the engagement row the
 * reference shows beneath every clip.
 *
 * WHY A PHOTO CAN STAND IN FOR A FRAME
 * There is no video record in this schema (see the module's own empty state,
 * `m.supply.videos`) — this board is an explicitly scoped, fady-only
 * PRESENTATION of what the module will look like once one exists, built from
 * the one real asset every product already has. The play control and
 * duration badge are honest about what they are: an affordance and a length,
 * not a claim that a clip exists behind them.
 */
function ReelCard({
  item,
  viewsLabel,
  likesLabel,
}: {
  item: ReelItem;
  viewsLabel: string;
  likesLabel: string;
}) {
  const views = decorativeFigure(item.id + "v", 180, 2400);
  const likes = decorativeFigure(item.id + "l", 12, 260);
  const duration = decorativeFigure(item.id + "d", 14, 58);

  return (
    <Link
      href={item.href}
      className="group flex w-40 shrink-0 flex-col gap-2 tablet:w-44"
    >
      <div className="relative overflow-hidden rounded-lg">
        <ProductMedia src={item.imageRef} alt={item.title} className="!aspect-[9/16]" />
        {/* The play control. Its own translucent disc, not a bare glyph —
            legible over a light product photo as easily as a dark one. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 grid place-items-center text-white/90 transition-opacity",
            "bg-brand-basalt/10 group-hover:bg-brand-basalt/25",
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-basalt/45 backdrop-blur-sm">
            <PlayIcon size={18} />
          </span>
        </span>
        <span className="absolute bottom-1.5 end-1.5 rounded-sm bg-brand-basalt/70 px-1.5 py-0.5 text-[0.6875rem] font-medium text-white">
          {formatDuration(duration)}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-label font-semibold text-fg">{item.title}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-caption text-fg-muted">
          <span className="shrink-0">
            {formatCompactCount(views)} {viewsLabel}
          </span>
          <span aria-hidden="true" className="shrink-0">
            ·
          </span>
          <span className="shrink-0">
            {formatCompactCount(likes)} {likesLabel}
          </span>
        </p>
      </div>
    </Link>
  );
}

/** Compact "1.2K" style count for the engagement row — this file does no
 *  locale-aware number work elsewhere, and a decorative figure does not
 *  need it either; it only needs to not print four raw digits. */
function formatCompactCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
}

export function ReelsBoard({
  title,
  viewAllLabel,
  viewAllHref,
  addLabel,
  addHref,
  items,
  viewsLabel,
  likesLabel,
  empty,
}: {
  title: string;
  viewAllLabel: string;
  viewAllHref: string;
  addLabel: string;
  addHref: string;
  items: ReelItem[];
  viewsLabel: string;
  likesLabel: string;
  empty: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-workspace-line bg-surface shadow-sm">
      <header className="flex min-w-0 items-center gap-2.5 px-4 py-3 tablet:px-5">
        <h2 className="truncate text-body-lg font-semibold text-fg">{title}</h2>
        <Link
          href={viewAllHref}
          className="ms-auto shrink-0 text-label font-semibold text-fg-secondary transition-colors hover:text-info"
        >
          {viewAllLabel}
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="px-5 pb-6">{empty}</div>
      ) : (
        <div className="flex min-w-0 gap-3 overflow-x-auto px-4 pb-4 tablet:px-5">
          {items.map((item) => (
            <ReelCard key={item.id} item={item} viewsLabel={viewsLabel} likesLabel={likesLabel} />
          ))}
        </div>
      )}

      <div className="border-t border-workspace-line px-4 py-2.5 tablet:px-5">
        <Link
          href={addHref}
          className="group flex items-center gap-2 text-label font-semibold text-fg transition-colors hover:text-info"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-pill bg-surface-2 text-fg-secondary transition-colors group-hover:bg-accent-solid/15 group-hover:text-accent">
            <PlusIcon size={13} />
          </span>
          {addLabel}
        </Link>
      </div>
    </section>
  );
}
