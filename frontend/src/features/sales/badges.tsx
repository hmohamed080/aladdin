"use client";

import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";
import { statusTone, priorityTone } from "@/lib/ui/format";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={statusTone(status)}>{t(`leads.statuses.${status}`)}</Badge>;
}

export function StageBadge({ stage }: { stage: string }) {
  const { t } = useI18n();
  return <Badge tone="accent">{t(`leads.stages.${stage}`)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useI18n();
  if (priority === "normal" || priority === "low") return null;
  return <Badge tone={priorityTone(priority)}>{t(`priority.${priority}`)}</Badge>;
}

export function CustomerStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={status === "archived" ? "neutral" : "success"}>
      {status === "archived" ? t("customers.statusArchived") : t("customers.statusActive")}
    </Badge>
  );
}

export function FollowUpStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = status === "completed" ? "success" : status === "cancelled" ? "neutral" : "info";
  return <Badge tone={tone}>{t(`followUps.statuses.${status}`)}</Badge>;
}
