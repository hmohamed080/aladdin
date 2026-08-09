"use client";

import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";

const ORDER_TONE: Record<string, "neutral" | "info" | "accent" | "success" | "danger"> = {
  confirmed: "info",
  in_progress: "accent",
  completed: "success",
  cancelled: "danger",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={ORDER_TONE[status] ?? "neutral"}>{t(`execution.orderStatus.${status}`)}</Badge>;
}

const PROJECT_TONE: Record<string, "neutral" | "info" | "accent" | "success"> = {
  planned: "info",
  active: "accent",
  completed: "success",
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={PROJECT_TONE[status] ?? "neutral"}>{t(`execution.projectStatus.${status}`)}</Badge>
  );
}

/** The terminal "PROJECT COMPLETED" marker. */
export function ProjectCompletedBadge() {
  const { t } = useI18n();
  return <Badge tone="success">{t("execution.projectCompleted")}</Badge>;
}
