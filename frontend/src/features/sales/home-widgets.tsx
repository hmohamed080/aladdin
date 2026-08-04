"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import { StageBadge, PriorityBadge } from "@/features/sales/badges";
import type { LeadRow, FollowUpRow, ActivityRow } from "@/server/queries/sales";

export function HomeQuickActions() {
  const { t } = useI18n();
  const actions = [
    { href: "/b2b/customers/new", label: t("home.addCustomer") },
    { href: "/b2b/leads/new", label: t("home.addLead") },
    { href: "/b2b/follow-ups", label: t("home.addFollowUp") },
  ];
  return (
    <section aria-label={t("home.quickActions")} className="flex flex-wrap gap-sm">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="inline-flex min-h-9 items-center rounded-sm border border-strong bg-surface px-md py-1.5 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          + {a.label}
        </Link>
      ))}
    </section>
  );
}

export function HomeLeadList({
  items,
  customerNames,
}: {
  items: LeadRow[];
  customerNames: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  return (
    <ul className="flex flex-col divide-y">
      {items.map((l) => (
        <li key={l.id} className="py-2">
          <Link href={`/b2b/leads/${l.id}`} className="flex items-center justify-between gap-md hover:text-accent">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-lg text-fg">{l.title}</span>
              <span className="block truncate text-label text-fg-muted">
                {l.customer_id ? customerNames[l.customer_id] ?? "—" : t("common.none")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <PriorityBadge priority={l.priority} />
              <StageBadge stage={l.stage} />
            </span>
          </Link>
          {l.next_follow_up_at ? (
            <p className="text-label text-fg-muted">
              {t("leads.nextFollowUp")}: {formatDate(l.next_follow_up_at, locale)}
            </p>
          ) : null}
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
  const color = tone === "danger" ? "text-danger" : "text-warning";
  return (
    <ul className="flex flex-col divide-y">
      {items.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-md py-2">
          <Link
            href={f.lead_id ? `/b2b/leads/${f.lead_id}` : "/b2b/follow-ups"}
            className="min-w-0 flex-1 truncate text-body-lg text-fg hover:text-accent"
          >
            {f.title}
          </Link>
          <span className={`shrink-0 text-label ${color}`}>{formatDate(f.due_at, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export function HomeStageCounts({ counts }: { counts: { stage: string; lead_count: number }[] }) {
  const { t } = useI18n();
  const order = ["new", "contacted", "qualified", "proposal_pending", "decision_pending"];
  const byStage = new Map(counts.map((c) => [c.stage, c.lead_count]));
  return (
    <ul className="flex flex-col gap-2">
      {order.map((stage) => {
        const n = byStage.get(stage) ?? 0;
        return (
          <li key={stage}>
            <Link
              href={`/b2b/leads?stage=${stage}`}
              className="flex items-center justify-between gap-md rounded-sm px-2 py-1.5 hover:bg-surface-2"
            >
              <span className="text-body-lg text-fg">{t(`leads.stages.${stage}`)}</span>
              <span className="font-mono text-body-lg text-fg-secondary">{n}</span>
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
    <ul className="flex flex-col divide-y">
      {items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-md py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-label text-accent">{t(`activities.${a.activity_type}`)}</span>
            <span className="block truncate text-body text-fg">{a.summary}</span>
          </span>
          <span className="shrink-0 text-label text-fg-muted">{formatDateTime(a.occurred_at, locale)}</span>
        </li>
      ))}
    </ul>
  );
}
