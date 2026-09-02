import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** A raised content surface. `pad="sm"` for tighter list cards. */
export function Card({
  className,
  pad = "lg",
  children,
}: {
  className?: string;
  pad?: "sm" | "lg";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-surface shadow-card",
        pad === "sm" ? "p-md" : "p-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Section heading with an optional leading icon and trailing action slot. */
export function SectionTitle({
  children,
  icon,
  action,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-md", className)}>
      <h2 className="flex min-w-0 items-center gap-2 text-title text-fg">
        {icon ? <span className="shrink-0 text-fg-secondary">{icon}</span> : null}
        <span className="truncate">{children}</span>
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-solid/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-label font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A labelled key/value row for detail panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="break-words text-body-lg text-fg">{children ?? "—"}</dd>
    </div>
  );
}

const stateTone = {
  neutral: { ring: "border-border", chip: "bg-surface-2 text-fg-secondary" },
  danger: { ring: "border-danger/40", chip: "bg-danger/15 text-danger" },
  warning: { ring: "border-warning/40", chip: "bg-warning/15 text-warning" },
} as const;

/** Empty / no-results / permission / error placeholder with an optional action. */
export function StatePanel({
  title,
  body,
  tone = "neutral",
  icon,
  action,
}: {
  title: string;
  body?: string;
  tone?: keyof typeof stateTone;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const t = stateTone[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-sm rounded-md border border-dashed bg-surface px-lg py-xl text-center",
        t.ring,
      )}
    >
      {icon ? (
        <span className={cn("mb-1 grid h-11 w-11 place-items-center rounded-pill", t.chip)} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="text-body-lg font-medium text-fg">{title}</p>
      {body ? <p className="max-w-md text-body text-fg-secondary">{body}</p> : null}
      {action ? <div className="mt-sm">{action}</div> : null}
    </div>
  );
}

/** Skeleton block for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-surface-2", className)} aria-hidden="true" />;
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-label text-danger">
      {children}
    </p>
  );
}

export function InlineSuccess({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-label text-success">
      {children}
    </p>
  );
}

const meterTones = {
  neutral: "bg-fg-muted",
  accent: "bg-accent-solid",
  success: "bg-success",
  warning: "bg-warning",
} as const;

const meterSizes = { sm: "h-1.5", md: "h-2.5" } as const;

/**
 * A measured proportion, ANNOUNCED — a real `progressbar`, not a decorative bar.
 *
 * ADDED TO THE FOUNDATION RATHER THAN TO A FEATURE FOLDER (R3/R6), and the
 * distinction from the one bar that already existed is not cosmetic.
 * `PanelRow`'s `share` is `aria-hidden` and structurally welded to a key/value
 * line: it annotates a figure that is already written beside it, in a summary
 * list, where the bar is the least important thing in the row. This is the
 * opposite case. Here the proportion IS the subject of the card, it appears
 * without a `PanelRow` around it, and it is the single fact a reader most needs —
 * so a bar that says nothing to a screen reader would hide the headline.
 *
 * Hence `role="progressbar"` with the three ARIA values and a required label:
 * "Progress, 60%" is what the sighted reader gets from the number beside it, and
 * there is no reason for anyone else to get less.
 *
 * It is deliberately NOT a Jobs component. A proportion of a known whole turns
 * up wherever work is measured, and the moment the second surface wanted one,
 * two copies would already exist.
 */
export function ProgressMeter({
  value,
  label,
  tone = "accent",
  size = "md",
}: {
  /** 0–100. Clamped, so bad data cannot overflow the track. */
  value: number;
  /** Accessible name — what this is the progress OF. */
  label: string;
  tone?: keyof typeof meterTones;
  size?: keyof typeof meterSizes;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("w-full overflow-hidden rounded-pill bg-surface-2", meterSizes[size])}
    >
      {/* Track and fill both rounded, so the cap shape survives a near-zero
          value. A zero renders as an empty track rather than a 2% stub: unlike a
          share in a breakdown, "none of it is done" is a meaningful reading here
          and should not be dressed up as a sliver of progress. */}
      <div
        className={cn("h-full rounded-pill transition-[width]", meterTones[tone])}
        /* Data, so it cannot be a utility class. */
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
