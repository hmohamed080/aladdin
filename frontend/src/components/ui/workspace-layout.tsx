import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { PlusIcon } from "@/components/ui/icons";

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
  actions,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  Icon?: ComponentType<{ size?: number }>;
  /** Small line above the title — the organization, or the section it sits in. */
  eyebrow?: string;
  /** Record count, shown as a pill beside the title. */
  count?: number;
  /** Primary actions (a create button, a link out). */
  actions?: ReactNode;
  /** Secondary controls that belong to the whole page (sort, export, help). */
  toolbar?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-md border-b pb-md">
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
                {count}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="mt-0.5 text-body text-fg-secondary">{subtitle}</p> : null}
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

export type KpiTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export type Kpi = {
  label: string;
  value: number | string;
  Icon: ComponentType<{ size?: number }>;
  tone?: KpiTone;
  /** The unit the value is counted in — "orders", "EGP". Never a fake trend. */
  unit?: string;
  /** One short line at the foot of the cell: context, or where the link goes. */
  foot?: string;
  href?: string;
};

const kpiChip: Record<KpiTone, string> = {
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-solid/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
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
 * A real count or total from the same query that fills the page, a unit, and one
 * line of context. Deliberately NOT a period-over-period delta: the reference
 * shows "+18% from last month" on every tile, and nothing in this database
 * produces a comparison period. A fabricated delta is a lie with a percentage
 * sign on it.
 */
export function KpiStrip({
  items,
  columns,
  className,
}: {
  items: Kpi[];
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
    <div className={cn("overflow-hidden rounded-md border bg-surface shadow-card", className)}>
      <div className={cn("-mb-px -me-px grid grid-cols-2 tablet:grid-cols-3", desktop)}>
        {items.map((item) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-label text-fg-secondary">{item.label}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-sm",
                    kpiChip[item.tone ?? "neutral"],
                  )}
                >
                  <item.Icon size={17} />
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="truncate font-display text-headline leading-none text-fg tabular-nums">
                  {item.value}
                </span>
                {item.unit ? (
                  <span className="shrink-0 text-label text-fg-muted">{item.unit}</span>
                ) : null}
              </div>
              {item.foot ? (
                <p className="mt-1.5 truncate text-label text-fg-muted">{item.foot}</p>
              ) : null}
            </>
          );
          const shell = "flex min-w-0 flex-col border-b border-e px-md py-3.5";
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

/**
 * A compact panel: header rule, title, optional trailing link, then content.
 * Tighter than `Card` on purpose — this is the unit the aside column and the
 * reference's dense sub-sections are built from.
 */
export function Panel({
  title,
  Icon,
  action,
  children,
  className,
  hint,
}: {
  title: string;
  Icon?: ComponentType<{ size?: number }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-md border bg-surface shadow-card", className)}>
      <div className="flex items-center justify-between gap-sm border-b bg-surface-2/40 px-md py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-body-lg font-medium text-fg">
          {Icon ? (
            <span className="shrink-0 text-fg-muted" aria-hidden="true">
              <Icon size={17} />
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </h2>
        {action ? <div className="shrink-0 text-label">{action}</div> : null}
      </div>
      <div className="px-md py-md">
        {hint ? <p className="mb-sm text-label text-fg-muted">{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

/**
 * A key/value line for the aside column. `emphasis` marks the one figure the
 * panel exists to show, so a breakdown still has a subject.
 */
export function PanelRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  tone?: KpiTone;
  href?: string;
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

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2 text-body text-fg-secondary">
        {dot}
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-body font-medium tabular-nums text-fg">{value}</span>
    </>
  );

  return href ? (
    <Link
      href={href}
      className="-mx-1 flex items-center justify-between gap-sm rounded-xs px-1 py-1.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {body}
    </Link>
  ) : (
    <div className="flex items-center justify-between gap-sm py-1.5">{body}</div>
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
  action,
  Icon,
  eyebrow,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  /** Result/record count shown as a subtle pill beside the title. */
  count?: number;
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
      Icon={Icon}
      eyebrow={eyebrow}
      toolbar={toolbar}
      actions={
        action ? (
          <Link
            href={action.href}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-brand-basalt shadow-sm transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <PlusIcon size={16} />
            {action.label}
          </Link>
        ) : undefined
      }
    />
  );
}
