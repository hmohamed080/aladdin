import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The one canonical record list for the workspace — do not fork it.
 *
 * Every showroom module (offers, orders, suppliers, technicians, institutions,
 * projects, team) shows the same shape of thing: a set of records with a leading
 * identity, a few attributes, a status, and a row action. Before Sprint 14 each
 * feature hand-rolled that, so column rhythm, empty states and mobile behaviour
 * drifted apart. This component fixes the rhythm in one place.
 *
 * Responsive strategy — the reason this is not just a `<table>`: a seven-column
 * table cannot shrink to 393px without either horizontal scroll (which the shell
 * forbids) or unreadable text. So the SAME column definitions render twice: a real
 * semantic table from `tablet` up, and a stacked card list below it, where the
 * first column becomes the card title and the rest become label/value rows. Columns
 * marked `secondary` are dropped from the card to keep it scannable.
 *
 * Server-safe: no client hooks, so pages can render it directly.
 */
export type Column<T> = {
  /** Stable key — also used as the React key. */
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align and use tabular figures (counts, money, dates). */
  numeric?: boolean;
  /** Hide from the desktop table below `desktop` width. */
  desktopOnly?: boolean;
  /** Omit from the mobile card — detail that does not survive the squeeze. */
  secondary?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible table caption — visually hidden, describes the list. */
  caption: string;
  /** Rendered instead of the table when there is nothing to show. */
  empty: ReactNode;
  className?: string;
}) {
  const lead = columns[0];
  if (rows.length === 0 || !lead) return <>{empty}</>;

  const cardColumns = columns.slice(1).filter((c) => !c.secondary);

  return (
    <div className={cn("min-w-0", className)}>
      {/* Desktop / tablet: a real table. */}
      <div className="hidden overflow-hidden rounded-md border bg-surface shadow-card tablet:block">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b bg-surface-2/50">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "px-md py-2.5 text-label font-medium text-fg-muted",
                    c.numeric ? "text-end" : "text-start",
                    c.desktopOnly && "hidden desktop:table-cell",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b last:border-b-0 transition-colors hover:bg-surface-2/40"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-md py-3 align-middle text-fg-secondary",
                      c.numeric ? "text-end tabular-nums" : "text-start",
                      c.desktopOnly && "hidden desktop:table-cell",
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: the same data as stacked cards. */}
      <ul className="flex flex-col gap-sm tablet:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-md border bg-surface p-md shadow-card">
            <div className="mb-2 text-body-lg font-medium text-fg">{lead.cell(row)}</div>
            <dl className="flex flex-col gap-1.5">
              {cardColumns.map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-md">
                  <dt className="shrink-0 text-label text-fg-muted">{c.header}</dt>
                  <dd
                    className={cn(
                      "min-w-0 text-end text-body text-fg-secondary",
                      c.numeric && "tabular-nums",
                    )}
                  >
                    {c.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The leading identity cell: a primary line with an optional muted second line
 * (supplier code, employee number, client name). Used as the first column so every
 * list opens the same way.
 */
export function RecordCell({
  title,
  meta,
  href,
  avatar,
}: {
  title: ReactNode;
  meta?: ReactNode;
  href?: string;
  /** Optional leading square (logo initials / avatar placeholder). */
  avatar?: ReactNode;
}) {
  const body = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-fg">{title}</span>
      {meta ? <span className="truncate text-label text-fg-muted">{meta}</span> : null}
    </span>
  );
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <span className="shrink-0">{avatar}</span> : null}
      {href ? (
        <a
          href={href}
          className="min-w-0 rounded-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </span>
  );
}

/**
 * A square identity mark built from a name — no image pipeline exists yet, and a
 * broken <img> reads worse than deliberate initials. Deterministic per name so the
 * same business always looks the same.
 */
export function Monogram({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-sm bg-surface-2 text-label font-semibold text-fg-secondary"
    >
      {initials}
    </span>
  );
}

/** Summary line under a list: "Showing N of M". */
export function ListFooter({ children }: { children: ReactNode }) {
  return <p className="mt-sm text-label text-fg-muted">{children}</p>;
}
