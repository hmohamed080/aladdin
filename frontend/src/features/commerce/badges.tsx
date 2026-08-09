"use client";

import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";

/** Product draft/published state. */
export function ProductStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={status === "published" ? "success" : "neutral"}>
      {t(`commerce.productStatus.${status}`)}
    </Badge>
  );
}

const RFQ_TONE: Record<string, "neutral" | "info" | "accent" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  quoted: "accent",
  closed: "success",
  cancelled: "danger",
};

export function RfqStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={RFQ_TONE[status] ?? "neutral"}>{t(`commerce.rfqStatus.${status}`)}</Badge>;
}

const QUOTE_TONE: Record<string, "neutral" | "info" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  accepted: "success",
  rejected: "danger",
};

export function QuotationStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={QUOTE_TONE[status] ?? "neutral"}>{t(`commerce.quotationStatus.${status}`)}</Badge>
  );
}

/** The READY FOR ORDER handoff marker shown on an accepted quotation. */
export function ReadyForOrderBadge() {
  const { t } = useI18n();
  return <Badge tone="success">{t("commerce.readyForOrder")}</Badge>;
}
