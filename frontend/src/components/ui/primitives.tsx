import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/** A raised content surface. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-md border bg-surface p-lg shadow-card", className)}>{children}</div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-title text-fg", className)}>{children}</h2>;
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
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-label",
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
    <div className="flex flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="text-body-lg text-fg">{children ?? "—"}</dd>
    </div>
  );
}

/** Empty / permission-denied / error placeholder with an optional action. */
export function StatePanel({
  title,
  body,
  tone = "neutral",
  action,
}: {
  title: string;
  body?: string;
  tone?: "neutral" | "danger" | "warning";
  action?: ReactNode;
}) {
  const ring =
    tone === "danger" ? "border-danger/40" : tone === "warning" ? "border-warning/40" : "border";
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-sm rounded-md border border-dashed bg-surface px-lg py-xl text-center",
        ring,
      )}
    >
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
