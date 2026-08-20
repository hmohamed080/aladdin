import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import type { KpiTone } from "@/components/ui/workspace-layout";
import { formatCount, formatDate } from "@/lib/ui/format";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

/**
 * THE ATTENTION QUEUE — the one block on the supply dashboard that is not a
 * table, a tile or a chart, and the reason the page stops reading as a
 * rearranged Showroom dashboard.
 *
 * WHAT IT IS FOR
 * A seller does not open the workspace asking "how many RFQs do I have"; they
 * ask "what is about to cost me a deal". That question crosses every stage of
 * the pipeline at once — a request nobody priced, a price nobody chased, an
 * accepted price with no order behind it, an order nobody progressed. No single
 * module owns that list, which is exactly why it belongs on the dashboard and
 * nowhere else. The modules below still own the full queues; this owns the
 * TRIAGE.
 *
 * WHY A ROW CARD AND NOT A TABLE
 * The Distributor reference's centre block is the shape being borrowed here: a
 * stack of wide rows, each carrying four or five LABELLED cells and its own
 * action button, rather than a header row with columns under it. Two properties
 * make it right for mixed-stage work that a table cannot have:
 *
 *  1. Every row can label its own date. A table forces one header for a column,
 *     so "required by", "valid until", "accepted on" and "confirmed on" would
 *     have to collapse into a meaningless "Date". Here each cell says what its
 *     own figure means, which is the only honest way to mix four record types.
 *  2. Every row can carry its own verb. "Price this", "Chase this", "Create the
 *     order", "Progress it" are four different jobs; one shared "View" column
 *     would flatten them back into a list of links.
 *
 * It is also, deliberately, the densest thing on the page: the rows carry a
 * leading tone rail, so severity is readable down the left edge in one pass
 * before any word is read.
 *
 * REAL RECORDS ONLY
 * Every item is assembled by the dashboard from records the caller's
 * organization is a party to, and `href` points at the module that owns it.
 * There is no "opportunity" store behind this and no scoring model — the order
 * is the stage order a seller works in, and nothing here is invented.
 *
 * Server-safe (no client hooks).
 */

/** The four jobs a supply-side seat can be behind on, in the order they arise. */
export type AttentionKind = "price" | "chase" | "order" | "fulfil";

export type AttentionItem = {
  /** Unique within the queue — the record id, prefixed by kind (ids can repeat across stages). */
  key: string;
  kind: AttentionKind;
  /** The record's own name — an RFQ title, a quotation's subject, an order. */
  title: string;
  /** How many lines the record carries, already formatted. */
  meta?: string;
  /** The business on the other side of it. */
  customer: string;
  /** Status wording for this record, and the tone the whole row inherits. */
  status: string;
  tone: KpiTone;
  /** The one date that matters for THIS job, with the label that says which date it is. */
  dateLabel: string;
  date: string | null;
  /** Money, where the stage genuinely has a figure. A request nobody priced has none. */
  amount?: string;
  amountLabel?: string;
  /** Where the work is actually done, and the verb for doing it. */
  href: string;
  cta: string;
};

const rail: Record<KpiTone, string> = {
  neutral: "bg-fg-muted",
  accent: "bg-accent-solid",
  iris: "bg-iris-solid",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

const chip: Record<KpiTone, string> = {
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-solid/15 text-accent",
  iris: "bg-iris-solid/15 text-iris",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
};

/** One labelled figure inside a row — the reference's cell, label above value. */
function Cell({
  label,
  children,
  className,
  clamp,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /**
   * Wrap over two lines instead of truncating — for a value that is a NAME.
   *
   * The two kinds of value in this row need opposite treatment, and getting it
   * backwards is what made the Arabic build unreadable. A date or a money figure
   * must stay on one line: it is short, and a wrapped "EGP 132,000.00" reads as
   * two numbers. A business name must NOT truncate, because `text-overflow`
   * clips at the end of the element's own direction — so in an RTL workspace a
   * Latin name lost its FIRST characters ("…ics Showroom" for Cairo Ceramics
   * Showroom), which is precisely the part that identifies it. Clamping wraps at
   * the line box instead, so the beginning always survives in either script.
   */
  clamp?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="truncate text-label text-fg-muted">{label}</span>
      <span className={cn("text-body text-fg", clamp ? "line-clamp-2" : "truncate")}>
        {children}
      </span>
    </div>
  );
}

export function AttentionQueue({
  items,
  locale,
  labels,
  empty,
}: {
  items: AttentionItem[];
  locale: Locale;
  /** Cell labels, resolved by the caller so this file holds no copy of its own. */
  labels: { status: string };
  /** Shown when nothing is waiting — which is a GOOD state and should read like one. */
  empty: ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;

  // The chevron follows the reader, not the layout: `Link` is one glyph and the
  // page is mirrored around it, so the arrow has to be chosen rather than flipped.
  const Arrow: ComponentType<{ size?: number }> = locale === "ar" ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <ul data-testid="attention-queue" className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            className={cn(
              "group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-sm border bg-surface-2/30 ps-4 pe-3 py-2.5",
              "transition-colors hover:border-strong hover:bg-surface-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
              /* The single-line row is a `wide` feature, and that threshold is
                 the load-bearing decision in this component. Five labelled
                 cells plus an action need roughly 800px to stay legible; below
                 that the cells were winning 60px each and every date and money
                 figure truncated mid-string, which is worse than no column at
                 all. Under `wide` the row falls back to the stacked form the
                 phone uses — a title, a two-up grid of the same labelled cells,
                 and the action — which is readable at ANY container width. */
              "wide:flex-row wide:items-center wide:gap-4",
            )}
          >
            {/* The severity rail. `start-0` rather than `left-0` so it stays on
                the reading edge in Arabic, where the row mirrors entirely. */}
            <span
              aria-hidden="true"
              className={cn("absolute inset-y-0 start-0 w-1", rail[item.tone])}
            />

            {/* Identity — the row's subject, and the only cell without a label
                because the record's own name needs none. */}
            {/* Identity: the record, then the business on the other side of it.
                The counterparty is a second line here rather than a labelled
                column of its own, and that is a width decision made on evidence.
                As a column it was the longest value in the row ("Cairo Ceramics
                Showroom"), so it set the floor for every other cell and pushed
                the dates and money figures into truncating at anything under a
                1700px display. As a meta line it wraps freely, costs no column,
                and matches how every record list in the workspace already names
                its counterparty (see `RecordCell`).

                Both lines are CLAMPED rather than truncated: `text-overflow`
                clips at the end of the element's own direction, so in the Arabic
                workspace a Latin name lost its FIRST characters ("…ics Showroom"
                for Cairo Ceramics Showroom) — the exact part that identifies it.
                A line clamp breaks at the line box instead, so the beginning
                survives in either script. */}
            <div className="flex min-w-0 flex-col wide:flex-[2.2_1_0%]">
              <span className="line-clamp-2 font-medium text-fg">{item.title}</span>
              <span className="line-clamp-2 text-label text-fg-muted">
                {item.meta ? `${item.customer} · ${item.meta}` : item.customer}
              </span>
            </div>

            {/* The attributes. On a phone they wrap into a two-up grid under the
                title rather than disappearing — a seller triaging on site needs
                the date and the money more than they need a tidy row. */}
            {/* `min-w-0` is load-bearing, not defensive. A flex item defaults to
                `min-width: auto`, which is its CONTENT's minimum — so a row
                carrying "EGP 628,800.00" refused to shrink to its flex basis
                while a row with no money cell shrank freely, and the two rows'
                columns landed on different vertical lines. With it, every row
                resolves to the same 1.7 / 3 split of the same container and the
                queue reads as columns. */}
            <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1.5 wide:flex wide:flex-[3_1_0%] wide:items-center wide:gap-4">
              {/* A floor, for the same reason the action has one and with the same
                  consequence if it is missing: the status word differs per row
                  ("Submitted" / "In progress" / "Ready for order"), so a cell
                  sized purely by proportion clipped the longer badges in English
                  while leaving the shorter ones room to spare. Wide enough for
                  the longest badge in either locale, every row's pill renders
                  whole and on the same line. */}
              <Cell label={labels.status} className="wide:min-w-28 wide:flex-1">
                <span
                  className={cn(
                    "inline-flex max-w-full items-center truncate rounded-pill px-2 py-0.5 text-label font-medium",
                    chip[item.tone],
                  )}
                >
                  {item.status}
                </span>
              </Cell>

              <Cell label={item.dateLabel} className="wide:flex-1">
                <span className="tabular-nums">
                  {item.date ? formatDate(item.date, locale) : "—"}
                </span>
              </Cell>

              {/* Rendered only where the stage HAS a figure: an unpriced request
                  has no total, and printing "—" under a money label reads as a
                  broken column rather than an absent one. The spacer keeps the
                  cells of every row in the queue on the same vertical lines. */}
              {item.amount ? (
                <Cell label={item.amountLabel ?? ""} className="wide:flex-1">
                  <span dir="ltr" className="font-medium tabular-nums">
                    {item.amount}
                  </span>
                </Cell>
              ) : (
                <span aria-hidden="true" className="hidden wide:block wide:flex-1" />
              )}
            </div>

            {/* The width floor is what keeps the queue reading as COLUMNS rather
                than as six independently-laid-out rows. The verb differs per
                stage ("Send a price" / "Follow up" / "Create the order"), and
                because the action is pinned to the far edge and never shrinks,
                an 18px-wider verb pushed that row's whole attribute block 18px
                across — enough that no two rows' labels lined up. A minimum
                wider than the longest verb in either locale fixes every real row
                to the same width.

                It applies from `wide` only, and that is the deliberate half of
                it: below 1440 the row is already short of room, and reserving
                160px for a 96px button there took the space out of the record's
                own name — which is the one thing in the row that cannot be
                guessed from context. Wide displays get aligned columns; narrower
                ones spend the pixels on legibility instead. */}
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 self-start rounded-sm border px-2.5 py-1 text-label font-medium text-fg-secondary",
                "transition-colors group-hover:border-accent-solid/50 group-hover:text-accent",
                "wide:min-w-36 wide:justify-center wide:self-auto",
              )}
            >
              {item.cta}
              <span aria-hidden="true">
                <Arrow size={14} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The queue's compact stage filter — "everything / to price / to chase / to
 * order / to fulfil".
 *
 * LINKS, NOT A CLIENT CONTROL
 * Every other filter in this workspace is a `<select>` that pushes to the router;
 * this one is a row of anchors, and the difference is what the control is FOR.
 * A period selector has four options that scope a whole strip of figures and is
 * used occasionally. This is a triage control used constantly, and its options
 * carry counts that are themselves information — "3 to price, 0 to chase" is a
 * thing the seller reads without ever clicking. Collapsing that into a closed
 * dropdown hides the most useful part of it, and a row of five chips costs no
 * JavaScript at all: they are server-rendered links that the browser prefetches.
 *
 * A stage with nothing in it is still drawn, greyed. Its absence would make the
 * row's contents change shape between visits, and "no requests waiting to be
 * priced" is the single most reassuring thing this panel can say.
 */
export function AttentionFilter({
  stages,
  active,
  basePath,
  locale,
  allLabel,
  query,
}: {
  stages: { key: AttentionKind; label: string; count: number }[];
  /** The stage currently filtered to, or `null` for everything. */
  active: AttentionKind | null;
  basePath: string;
  locale: Locale;
  allLabel: string;
  /**
   * Parameters that must survive a stage change — the period, above all.
   * Filtering the queue must not silently reset the figures in the strip above.
   */
  query?: Record<string, string>;
}) {
  const href = (stage: AttentionKind | null) => {
    const params = new URLSearchParams(query);
    // "Everything" is the default, so it carries no parameter and the dashboard
    // URL stays clean until a filter is deliberately chosen.
    if (stage) params.set("stage", stage);
    else params.delete("stage");
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const chipFor = (isActive: boolean, empty: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-label transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      isActive
        ? "border-iris-solid/40 bg-iris-solid/15 font-medium text-iris"
        : empty
          ? "border-transparent bg-surface-2/60 text-fg-muted hover:bg-surface-hover"
          : "border-transparent bg-surface-2 text-fg-secondary hover:bg-surface-hover hover:text-fg",
    );

  const total = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    // The row scrolls rather than wraps: it sits in a panel header beside a
    // title, and a wrapping chip row silently doubles that header's height on
    // the one viewport where vertical space is scarcest.
    <div className="-mx-1 flex max-w-full items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
      {/* Ordinary `<Link>`s. Worth saying only because a lot of effort went into
          proving they did not need to be anything cleverer: a chip changes only
          the query string of the page it is already on, the navigation is a
          server render of a `force-dynamic` dashboard behind seven queries, and
          on a cold path it can take several seconds to commit. That reads as "I
          clicked and nothing happened" — which is a LATENCY problem, not a
          routing one, and the fix for it is to make the dashboard's render
          cheaper rather than to hand-roll the router. */}
      <Link href={href(null)} className={chipFor(active === null, total === 0)}>
        {allLabel}
        <span className="tabular-nums">{formatCount(total, locale)}</span>
      </Link>
      {stages.map((s) => (
        <Link
          key={s.key}
          href={href(s.key)}
          className={chipFor(active === s.key, s.count === 0)}
        >
          {s.label}
          <span className="tabular-nums">{formatCount(s.count, locale)}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * The count pill the queue's own header carries.
 *
 * Split out because the header lives on a `Panel` and the number belongs to the
 * queue: one place decides how "6 things are waiting" is drawn and numbered.
 */
export function AttentionCount({
  count,
  locale,
  tone,
}: {
  count: number;
  locale: Locale;
  tone: KpiTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-pill px-2 py-0.5 text-label font-medium tabular-nums",
        chip[tone],
      )}
    >
      {formatCount(count, locale)}
    </span>
  );
}
