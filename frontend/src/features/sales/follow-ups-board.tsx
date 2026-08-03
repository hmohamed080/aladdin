"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/ui/format";
import { SectionTitle } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { FollowUpStatusBadge, PriorityBadge } from "@/features/sales/badges";
import {
  completeFollowUpAction,
  reopenFollowUpAction,
  cancelFollowUpAction,
} from "@/server/actions/sales-forms";
import type { FollowUpRow } from "@/server/queries/sales";

type Names = Record<string, string>;
type Groups = { overdue: FollowUpRow[]; dueToday: FollowUpRow[]; upcoming: FollowUpRow[]; completed: FollowUpRow[] };

export function FollowUpsBoard({
  groups,
  customerNames,
}: {
  groups: Groups;
  customerNames: Names;
  memberNames: Names;
  canAssign: boolean;
}) {
  const { t, locale } = useI18n();

  const sections: { key: keyof Groups; label: string; tone: "danger" | "warning" | "neutral" | "success" }[] = [
    { key: "overdue", label: t("followUps.overdue"), tone: "danger" },
    { key: "dueToday", label: t("followUps.dueToday"), tone: "warning" },
    { key: "upcoming", label: t("followUps.upcoming"), tone: "neutral" },
    { key: "completed", label: t("followUps.completed"), tone: "success" },
  ];

  return (
    <div className="flex flex-col gap-lg">
      {sections.map((s) => {
        const items = groups[s.key];
        if (items.length === 0) return null;
        return (
          <section key={s.key}>
            <SectionTitle className="mb-sm">
              {s.label} <span className="text-fg-muted">({items.length})</span>
            </SectionTitle>
            <ul className="flex flex-col gap-sm">
              {items.map((f) => (
                <li key={f.id} className="rounded-md border bg-surface p-md">
                  <div className="flex flex-wrap items-start justify-between gap-md">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-body-lg font-medium text-fg">{f.title}</span>
                        <PriorityBadge priority={f.priority} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-md gap-y-0.5 text-label text-fg-secondary">
                        <span className={s.tone === "danger" ? "text-danger" : s.tone === "warning" ? "text-warning" : ""}>
                          {formatDate(f.due_at, locale)}
                        </span>
                        {f.lead_id ? (
                          <Link href={`/b2b/leads/${f.lead_id}`} className="text-accent hover:underline">
                            {t("nav.leads")}
                          </Link>
                        ) : null}
                        {f.customer_id ? (
                          <span>{customerNames[f.customer_id] ?? ""}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-sm">
                      <FollowUpStatusBadge status={f.status} />
                      {f.status === "open" ? (
                        <>
                          <LifecycleButton action={completeFollowUpAction} id={f.id} leadId={f.lead_id} label={t("followUps.complete")} variant="accent" />
                          <LifecycleButton action={cancelFollowUpAction} id={f.id} leadId={f.lead_id} label={t("followUps.cancel")} variant="ghost" />
                        </>
                      ) : f.status === "completed" ? (
                        <LifecycleButton action={reopenFollowUpAction} id={f.id} leadId={f.lead_id} label={t("followUps.reopen")} variant="outline" />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LifecycleButton({
  action,
  id,
  leadId,
  label,
  variant,
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  leadId: string | null;
  label: string;
  variant: "accent" | "ghost" | "outline";
}) {
  const { t } = useI18n();
  return (
    <form action={action}>
      <input type="hidden" name="followUpId" value={id} />
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <SubmitButton variant={variant} pendingLabel={t("common.saving")}>
        {label}
      </SubmitButton>
    </form>
  );
}
