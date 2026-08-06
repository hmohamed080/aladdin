"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import { StageBadge, PriorityBadge } from "@/features/sales/badges";
import { AlertIcon, ClockIcon, TargetIcon, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import type { LeadRow, FollowUpRow, ActivityRow } from "@/server/queries/sales";

export function HomeQuickActions() {
  const { t } = useI18n();
  const actions = [
    { href: "/b2b/customers/new", label: t("home.addCustomer"), primary: true },
    { href: "/b2b/leads/new", label: t("home.addLead"), primary: false },
    { href: "/b2b/follow-ups", label: t("home.addFollowUp"), primary: false },
  ];
  return (
    <section aria-label={t("home.quickActions")} className="flex flex-wrap gap-sm">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={cn(
            "inline-flex min-h-10 items-center gap-2 rounded-sm px-md py-2 text-label font-medium transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            a.primary
              ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90"
              : "border border-strong bg-surface text-fg hover:bg-surface-2",
          )}
        >
          <PlusIcon size={16} />
          {a.label}
        </Link>
      ))}
    </section>
  );
}

/** At-a-glance KPI tiles: overdue, due today, my open leads. */
export function HomeStatTiles({
  overdue,
  dueToday,
  openLeads,
}: {
  overdue: number;
  dueToday: number;
  openLeads: number;
}) {
  const { t } = useI18n();
  const tiles = [
    { href: "/b2b/follow-ups", label: t("home.overdue"), value: overdue, Icon: AlertIcon, tone: "danger" as const },
    { href: "/b2b/follow-ups", label: t("home.dueToday"), value: dueToday, Icon: ClockIcon, tone: "warning" as const },
    { href: "/b2b/leads", label: t("home.myOpenLeads"), value: openLeads, Icon: TargetIcon, tone: "accent" as const },
  ];
  const chip = {
    danger: "bg-danger/15 text-danger",
    warning: "bg-warning/15 text-warning",
    accent: "bg-accent-solid/15 text-accent",
  };
  return (
    <div className="grid grid-cols-1 gap-md tablet:grid-cols-3 [&>*]:min-w-0">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="group flex items-center gap-md rounded-md border bg-surface p-md shadow-card transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-sm", chip[tile.tone])} aria-hidden="true">
            <tile.Icon size={22} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-headline leading-none text-fg">{tile.value}</span>
            <span className="mt-1 block truncate text-label text-fg-secondary">{tile.label}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-2 text-body text-fg-secondary">{children}</p>;
}

export function HomeLeadList({
  items,
  customerNames,
}: {
  items: LeadRow[];
  customerNames: Record<string, string>;
}) {
  const { t } = useI18n();
  return (
    <ul className="-mx-2 flex flex-col divide-y">
      {items.map((l) => (
        <li key={l.id} className="px-2 py-2.5">
          <Link
            href={`/b2b/leads/${l.id}`}
            className="flex items-center justify-between gap-md rounded-sm hover:text-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-lg font-medium text-fg">{l.title}</span>
              <span className="block truncate text-label text-fg-muted">
                {l.customer_id ? customerNames[l.customer_id] ?? "—" : t("common.none")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <PriorityBadge priority={l.priority} />
              <StageBadge stage={l.stage} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HomeFollowUpList({
  items,
  tone,
}: {
  items: FollowUpRow[];
  tone: "danger" | "warning";
}) {
  const { locale } = useI18n();
  const dot = tone === "danger" ? "bg-danger" : "bg-warning";
  const color = tone === "danger" ? "text-danger" : "text-warning";
  return (
    <ul className="-mx-2 flex flex-col divide-y">
      {items.map((f) => (
        <li key={f.id} className="flex items-center gap-sm px-2 py-2.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-pill", dot)} aria-hidden="true" />
          <Link
            href={f.lead_id ? `/b2b/leads/${f.lead_id}` : "/b2b/follow-ups"}
            className="min-w-0 flex-1 truncate text-body-lg text-fg hover:text-accent"
          >
            {f.title}
          </Link>
          <span className={cn("shrink-0 text-label font-medium", color)}>{formatDate(f.due_at, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export function HomeStageCounts({ counts }: { counts: { stage: string; lead_count: number }[] }) {
  const { t } = useI18n();
  const order = ["new", "contacted", "qualified", "proposal_pending", "decision_pending"];
  const byStage = new Map(counts.map((c) => [c.stage, c.lead_count]));
  const max = Math.max(1, ...order.map((s) => byStage.get(s) ?? 0));
  return (
    <ul className="flex flex-col gap-1.5">
      {order.map((stage) => {
        const n = byStage.get(stage) ?? 0;
        return (
          <li key={stage}>
            <Link
              href={`/b2b/leads?stage=${stage}`}
              className="flex items-center gap-md rounded-sm px-2 py-1.5 hover:bg-surface-2"
            >
              <span className="w-28 shrink-0 truncate text-body text-fg">{t(`leads.stages.${stage}`)}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
                <span
                  className="block h-full rounded-pill bg-accent-solid/70"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-end font-mono text-body-lg text-fg-secondary">{n}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function HomeActivityList({ items }: { items: ActivityRow[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className="-mx-2 flex flex-col divide-y">
      {items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-md px-2 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-label font-medium text-accent">{t(`activities.${a.activity_type}`)}</span>
            <span className="block truncate text-body text-fg">{a.summary}</span>
          </span>
          <span className="shrink-0 text-label text-fg-muted">{formatDateTime(a.occurred_at, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export { EmptyLine };
