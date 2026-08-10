import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui/primitives";

/** Compact page header for the admin console. */
export function AdminHeader({ title, subtitle, count }: { title: string; subtitle?: string; count?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <h1 className="text-title text-fg">{title}</h1>
        {typeof count === "number" ? (
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-label text-fg-secondary">{count}</span>
        ) : null}
      </div>
      {subtitle ? <p className="text-body text-fg-secondary">{subtitle}</p> : null}
    </div>
  );
}

/** A single KPI tile. */
export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card pad="sm" className="flex flex-col gap-0.5">
      <span className="text-label text-fg-muted">{label}</span>
      <span className="text-headline font-semibold text-fg">{value}</span>
      {hint ? <span className="text-label text-fg-muted">{hint}</span> : null}
    </Card>
  );
}

/** Horizontal distribution of labelled counts. */
export function DistList({ entries }: { entries: { label: string; value: number }[] }) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  return (
    <div className="flex flex-col gap-2">
      {entries.map((e) => (
        <div key={e.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-label text-fg-secondary">{e.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2">
            <div
              className="h-full rounded-pill bg-accent-solid"
              style={{ width: `${(e.value / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-end text-label font-medium text-fg">{e.value}</span>
        </div>
      ))}
    </div>
  );
}

const statusTones: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  active: "success",
  approved: "success",
  accepted: "success",
  verified: "success",
  submitted: "warning",
  under_review: "info",
  needs_more_info: "warning",
  pending_verification: "warning",
  pending: "warning",
  draft: "neutral",
  invited: "warning",
  suspended: "warning",
  rejected: "danger",
  revoked: "danger",
  expired: "danger",
  deactivated: "danger",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={statusTones[status] ?? "neutral"}>{label}</Badge>;
}

/** Responsive table wrapper that scrolls horizontally rather than overflowing. */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[36rem] border-collapse text-start text-body">{children}</table>
    </div>
  );
}
