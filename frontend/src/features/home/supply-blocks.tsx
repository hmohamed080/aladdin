import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import type { Locale } from "@/lib/i18n/locales";
import type { KpiTone } from "@/components/ui/workspace-layout";
import type { DemandLine, DemandMovementRow } from "@/server/queries/commerce";
import { formatCount, formatDate, formatPercent, formatQuantity } from "@/lib/ui/format";
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, VideoIcon } from "@/components/ui/icons";

/**
 * The supply dashboard's own blocks — the four modules that are not a table, a
 * tile, a chart or the attention queue.
 *
 * They live together because they share one property that governs how all four
 * are written: EACH ONE IS THE HONEST VERSION OF A REFERENCE BLOCK THAT HAS NO
 * BACKEND HERE.
 *
 * The Distributor reference draws an opportunity feed fed by a cross-marketplace
 * matching engine, a market-intelligence panel with regional demand indices, a
 * notification stream, and a Reels rail with view and like counts. This
 * repository has a matching engine (none), a market data provider (none), a
 * notifications table (none) and a video model (none). Four blocks could
 * therefore have been dropped, or four blocks could have been filled with
 * plausible numbers. Both are wrong: dropping them loses composition the seller
 * genuinely benefits from, and filling them invents business intelligence.
 *
 * So each block is rebuilt on the ONE dataset that is real — the requests buyers
 * actually addressed to this organization, and the lines inside them — and where
 * even that does not exist, the block renders an empty state that says so in
 * plain words. A dashboard whose every figure can be clicked through to the
 * record it came from is worth more than one that looks like the reference.
 *
 * All server components; none holds copy of its own.
 */

/* ===========================================================================
 * فرص جديدة مناسبة لك — new demand suited to you
 * ========================================================================= */

/**
 * Unpriced requests, read as OPPORTUNITIES rather than as a work queue.
 *
 * This is the same table the attention queue's "price this" rows come from, and
 * showing it twice is deliberate rather than an oversight. The two blocks ask
 * different questions of it: the queue asks "what am I late on", ordered by
 * stage and capped at three per stage, while this asks "what is being asked for"
 * and reads INSIDE the request, one row per product line. A seller scanning for
 * something they can supply well is looking at product and quantity, which the
 * queue never shows — it shows the request's title, because that is what you
 * triage by.
 *
 * WHAT IS NOT HERE, AND WHY THE COPY SAYS SO
 * The reference's cards carry a region, a count of "showrooms interested in this
 * product", and an urgency score. `rfq_list` has no location column, there is no
 * cross-buyer interest signal, and nothing scores urgency — so none of the three
 * is drawn. The panel's own hint tells the reader what the list actually is
 * (requests addressed to you), which is the difference between a modest true
 * block and a convincing false one.
 */
export function OpportunityList({
  lines,
  locale,
  labels,
  unitLabel,
  empty,
}: {
  lines: DemandLine[];
  locale: Locale;
  labels: {
    quantity: string;
    buyer: string;
    required: string;
    status: string;
    cta: string;
    /** "+{count} more items on this request" — the request's other lines. */
    more: string;
  };
  /** Resolves a `product_unit` to its localized noun; owned by the caller. */
  unitLabel: (unit: DemandLine["unit"]) => string;
  empty: ReactNode;
}) {
  if (lines.length === 0) return <>{empty}</>;
  const Arrow: ComponentType<{ size?: number }> = locale === "ar" ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line, i) => (
        // The line is not a record — the REQUEST is — so the key has to carry
        // both: one request contributing three product lines would otherwise
        // give React three children with the same key.
        <li key={`${line.rfqId}-${line.productName}-${i}`}>
          <Link
            href={`/b2b/rfqs/${line.rfqId}`}
            className={cn(
              "group flex min-w-0 flex-col gap-2 rounded-sm border bg-surface-2/30 px-3 py-2.5",
              "transition-colors hover:border-strong hover:bg-surface-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                {/* The PRODUCT leads, not the request title. A seller decides
                    whether an opportunity is theirs by what is being asked for;
                    the request's own name ("Villa 12 finishing") tells them
                    nothing about whether they stock it. */}
                <p className="line-clamp-2 font-medium text-fg">{line.productName}</p>
                <p className="line-clamp-2 text-label text-fg-muted">{line.title}</p>
              </div>
              <span className="shrink-0 rounded-pill bg-iris-solid/15 px-2 py-0.5 text-label font-medium text-iris">
                {labels.status}
              </span>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1">
              <Field label={labels.quantity}>
                <span className="tabular-nums">
                  {formatQuantity(line.quantity, locale)} {unitLabel(line.unit)}
                </span>
              </Field>
              <Field label={labels.buyer}>
                {line.buyer}
              </Field>
              {line.requiredDate ? (
                <Field label={labels.required}>
                  <span className="tabular-nums">{formatDate(line.requiredDate, locale)}</span>
                </Field>
              ) : null}
              {line.siblings > 0 ? (
                <Field label="">
                  <span className="text-fg-muted">
                    {labels.more.replace("{count}", formatCount(line.siblings, locale))}
                  </span>
                </Field>
              ) : null}
            </div>

            <span className="inline-flex items-center gap-1 text-label font-medium text-iris transition-colors group-hover:underline">
              {labels.cta}
              <span aria-hidden="true">
                <Arrow size={13} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A labelled value inside an opportunity card. An empty label draws no caption.
 *
 * EVERY value wraps over two lines; none truncates, and that is a correctness
 * rule rather than a spacing preference.
 *
 * `text-overflow` — and a one-line clamp, which behaves identically — cuts at
 * the end of the element's OWN direction. In this Arabic workspace that end is
 * on the left, so a Latin business name lost its opening characters: "New Cairo
 * Design Studio" rendered as "…ew Cairo Design", which is not a shortened name
 * but a different one, and "Zayed Home Showroom" became "…Zayed Home", which
 * silently drops the word that says what kind of business it is. This block sits
 * in the narrowest column on the page, so it hits that case on almost every row.
 *
 * Wrapping breaks at the line box instead, so the beginning always survives in
 * either script. The card growing a line taller is the cheap half of the trade;
 * beside a queue that is always taller than this panel, that height was surplus
 * anyway.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      {label ? <span className="truncate text-label text-fg-muted">{label}</span> : null}
      <span className="line-clamp-2 text-label text-fg">{children}</span>
    </div>
  );
}

/* ===========================================================================
 * حركة السوق — demand movement
 * ========================================================================= */

/**
 * Which of this organization's products are being asked for, and whether that is
 * rising.
 *
 * THE HONEST SCOPE OF THE WORD "MARKET"
 * This is NOT the market. It is the demand that reached THIS organization, and
 * the panel's hint says exactly that. A distributor cannot see requests addressed
 * to their competitors — RLS makes sure of it — so a genuine market index is not
 * something this product can compute today, and a panel labelled "market
 * movement" that silently means "your own inbox" would be the most quietly
 * misleading thing on the page. The block keeps the reference's SHAPE (ranked
 * products, a share bar, a movement arrow) over the data that is real.
 *
 * `share` is measured against the BUSIEST product, not against the window's
 * total requests: one request naming four products counts once for each, so the
 * counts deliberately sum to more than the number of requests and a percentage
 * "of all demand" would exceed 100%. Bar length relative to the leader is a
 * comparison the numbers actually support.
 *
 * The movement figure is rendered ONLY where the previous window had a non-zero
 * baseline — the same rule `KpiDelta` states, for the same reason. A product
 * first requested this month is new, not up ∞%.
 */
export function MarketMovement({
  rows,
  locale,
  labels,
  empty,
}: {
  rows: DemandMovementRow[];
  locale: Locale;
  labels: { requests: string; new: string };
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  const max = Math.max(...rows.map((r) => r.requests), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const hasBaseline = row.previous > 0;
        const pct = hasBaseline ? ((row.requests - row.previous) / row.previous) * 100 : null;
        return (
          <li key={row.name} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-body text-fg-secondary">{row.name}</span>
              <span className="flex shrink-0 items-baseline gap-1.5 text-label">
                {pct !== null ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 font-medium tabular-nums",
                      // Rising demand for what you sell is good; falling is not.
                      // This metric HAS an inherent direction, unlike most, so
                      // colouring by sign is legitimate here.
                      pct >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    <span aria-hidden="true">{pct >= 0 ? "↑" : "↓"}</span>
                    {formatPercent(Math.abs(pct), locale)}
                  </span>
                ) : (
                  <span className="text-fg-muted">{labels.new}</span>
                )}
                <span className="font-medium tabular-nums text-fg">
                  {formatCount(row.requests, locale)}
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full rounded-pill bg-iris-solid"
                style={{ width: `${Math.max((row.requests / max) * 100, 6)}%` }}
              />
            </div>
            <p className="sr-only">
              {labels.requests}: {formatCount(row.requests, locale)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/* ===========================================================================
 * مسار عملك — the working pipeline
 * ========================================================================= */

export type FlowStage = {
  key: string;
  label: string;
  value: number;
  tone: KpiTone;
  href: string;
};

const flowBar: Record<KpiTone, string> = {
  neutral: "bg-fg-muted",
  accent: "bg-accent-solid",
  iris: "bg-iris-solid",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/**
 * The commerce lifecycle as a stage flow: request → quotation → accepted →
 * order → running.
 *
 * WHY VERTICAL, WHEN A PIPELINE IS THE CANONICAL HORIZONTAL DIAGRAM
 * Because it shares a row with two other panels and therefore owns about a third
 * of the page. Five horizontal stages in a 380px column give each stage 60px, at
 * which point every label truncates and the arrows between them are wider than
 * the words — a diagram that has to be decoded is not a summary. Stacked, each
 * stage gets the full column width for its label, its count and a proportion
 * bar, and the connector between rows carries the direction that the horizontal
 * arrow would have.
 *
 * NOT A FUNNEL, and the distinction is why the bars are measured the way they
 * are. A funnel asserts that stage N+1 is a SUBSET of stage N, which is false
 * here: this month's orders came from last month's quotations, and a request can
 * produce several quotations. Each bar is therefore a share of the largest stage
 * — a comparison of sizes, which is true — and never a conversion rate, which
 * would not be.
 */
export function WorkflowFlow({
  stages,
  locale,
}: {
  stages: FlowStage[];
  locale: Locale;
}) {
  const max = Math.max(...stages.map((s) => s.value), 1);

  return (
    <ol className="flex flex-col">
      {stages.map((stage, i) => (
        <li key={stage.key} className="relative min-w-0 ps-5">
          {/* The connector. It runs from this stage's dot to the next one, so
              the LAST row draws none — a line trailing off the bottom of the
              list implies a sixth stage that does not exist. */}
          {i < stages.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute start-[0.3125rem] top-2 h-full w-px bg-border"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              "absolute start-0 top-1.5 h-2.5 w-2.5 rounded-pill ring-2 ring-surface",
              flowBar[stage.tone],
            )}
          />
          <Link
            href={stage.href}
            className="group block min-w-0 rounded-sm pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-body text-fg-secondary group-hover:text-fg">
                {stage.label}
              </span>
              <span className="shrink-0 text-label font-medium tabular-nums text-fg">
                {formatCount(stage.value, locale)}
              </span>
            </div>
            {/* The BAR is one colour for every stage; only the DOT carries the
                stage's tone. Painting both meant five hues stacked in a 380px
                column — red, ochre, green, blue, violet — which read as a
                rainbow rather than as a pipeline, and the ochre bar in
                particular went muddy against the light ground. The bar's job is
                to compare five lengths, and a comparison is easier to make in
                one colour; the dot beside it still says which stage this is. */}
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
              <div
                className="h-full rounded-pill bg-iris-solid"
                style={{ width: `${Math.max((stage.value / max) * 100, 4)}%` }}
              />
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/* ===========================================================================
 * أحدث الإشعارات · فيديوهات لمنتجاتك — the two blocks with no model yet
 * ========================================================================= */

/**
 * The notification stream, before there is one.
 *
 * There is no `notifications` table in this schema and no writer for one; the
 * feature directory holds a README and nothing else. The reference's panel shows
 * four entries with relative timestamps and an unread badge, and reproducing
 * that from the records that DO exist — "you received a request 10 minutes ago"
 * — would be a feed derived from a list already on this page, presented as if a
 * notification system had delivered it. That is a fake, and a fake that becomes
 * a support burden the moment someone asks why one did not arrive by e-mail.
 *
 * So the block renders its honest state and holds its place in the composition.
 * When the notifications sprint lands, the empty state stays as the zero case
 * and a list renders above it — no layout work is carried forward.
 *
 * Explicitly NO unread count on the panel: a badge reading "0" invites the
 * reader to believe the count is live.
 */
export function NotificationsEmpty({ title, body }: { title: string; body: string }) {
  return <BlockEmpty icon={<BellIcon size={20} />} title={title} body={body} />;
}

/**
 * Product clips, before the media model exists.
 *
 * `products` carries a single `image_ref` — one still image, a free-text
 * reference — and no video column, no media table and no upload path. The
 * reference's rail shows three clips with durations, view counts and like
 * counts; every one of those numbers would have to be invented, and the videos
 * themselves would have to be the reference's own.
 *
 * The action points at the catalogue, which is a route that exists and the place
 * this will eventually be managed from. It is deliberately NOT labelled "add a
 * video": the catalogue cannot accept one today, and a button that names an
 * action the product cannot perform is worse than no button.
 */
export function ProductVideosEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return <BlockEmpty icon={<VideoIcon size={20} />} title={title} body={body} action={action} />;
}

/**
 * The empty state a DASHBOARD CELL gets, as opposed to the one a page gets.
 *
 * `StatePanel` is the page-level version and is wrong here for one measurable
 * reason: it is a fixed-height box (`py-xl`, a 44px icon disc, body text at
 * `text-body`) that sits at the top of whatever contains it. Dropped into a
 * panel that stretches to match a taller neighbour, it left 150px of blank
 * surface beneath itself — the "giant empty space" a dashboard must not have,
 * and the exact thing that makes an honest empty state look like a bug.
 *
 * This one stretches (`h-full`, inside a panel body told to be a flex column)
 * and centres its content, so the space the row's tallest panel dictates becomes
 * deliberate padding around a centred message instead of a void under a small
 * one. It is also quieter — smaller disc, `text-label` body — because a cell
 * that has nothing to report should not shout it at the same volume as the
 * panels either side that do.
 */
export function BlockEmpty({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-36 flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed bg-surface-2/20 px-md py-lg text-center">
      <span
        aria-hidden="true"
        className="mb-0.5 grid h-10 w-10 place-items-center rounded-pill bg-surface-2 text-fg-muted"
      >
        {icon}
      </span>
      <p className="text-body font-medium text-fg">{title}</p>
      <p className="max-w-xs text-label text-fg-muted">{body}</p>
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
