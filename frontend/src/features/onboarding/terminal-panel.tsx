"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge } from "@/components/ui/primitives";
import { ApertureMark, CalendarCheckIcon, ClockIcon } from "@/components/ui/icons";

/**
 * A calm terminal card for the individual onboarding handoffs (Sprint 7.4). It is a
 * handoff state, not an activation: the consumer completion and the professional
 * "submitted for review" both land here. A safe resume (sign out / return) is always
 * available via the layout chrome; no misleading workspace CTA is shown for a
 * not-yet-activated account.
 */
export function TerminalPanel({
  tone,
  badge,
  title,
  body,
  children,
}: {
  tone: "success" | "info";
  badge: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <ApertureMark size={36} />
        <Badge tone={tone}>
          <span className="inline-flex items-center gap-1.5">
            {tone === "success" ? <CalendarCheckIcon size={14} /> : <ClockIcon size={14} />}
            {badge}
          </span>
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display-ar text-headline text-fg">{title}</h1>
        <p className="text-body-lg text-fg-secondary">{body}</p>
      </div>
      {children}
      <p className="text-label text-fg-muted">{t("onboarding.handoff.resumeHint")}</p>
    </Card>
  );
}
