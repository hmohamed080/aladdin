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
