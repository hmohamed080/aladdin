"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { CalendarCheckIcon } from "@/components/ui/icons";
import { Brand } from "@/components/layout/brand";

export type Track = "consumer" | "professional" | "business";

/** Where the "Continue" action actually takes the user, per track. */
const NEXT_ROUTE: Record<Track, string> = {
  consumer: "/onboarding/consumer",
  professional: "/onboarding/professional",
  business: "/onboarding/business",
};

/**
 * The onboarding handoff / transition. Shows the chosen account type and what
 * comes next, then hands off into that persona's actual wizard — a deliberate
 * stop, not an instant jump straight from account-type selection into the next
 * form. It is a handoff state, not activation: business personas still need
 * review. A safe resume destination (sign out / return) is always available.
 */
export function HandoffPanel({
  track,
  accountTypeKey,
}: {
  track: Track;
  accountTypeKey: string | null;
}) {
  const { t } = useI18n();

  const nextCopy: Record<Track, string> = {
    consumer: t("onboarding.handoff.consumerNext"),
    professional: t("onboarding.handoff.personaNext"),
    business: t("onboarding.handoff.businessNext"),
  };
  const typeLabel = accountTypeKey
    ? t(`onboarding.accountType.types.${accountTypeKey}`)
    : track === "consumer"
      ? t("onboarding.accountType.types.end_consumer")
      : t("onboarding.accountType.types.organization_owner_manager");

  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <Brand name={t("common.appName")} size="sm" wordmark={false} />
        <Badge tone="success">
          <span className="inline-flex items-center gap-1.5">
            <CalendarCheckIcon size={14} />
            {t("onboarding.verified")}
          </span>
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-headline text-fg">{t("onboarding.handoff.title")}</h1>
      </div>

      <dl className="flex flex-col gap-md">
        <div className="flex flex-col gap-0.5">
          <dt className="text-label text-fg-muted">{t("onboarding.handoff.selectedLabel")}</dt>
          <dd className="text-body-lg font-medium text-fg">{typeLabel}</dd>
        </div>
        <div className="flex flex-col gap-0.5 rounded-md border border-strong/70 bg-surface-2/40 p-md">
          <dt className="text-label text-fg-muted">{t("onboarding.handoff.nextLabel")}</dt>
          <dd className="text-body text-fg">{nextCopy[track]}</dd>
        </div>
      </dl>

      <p className="text-label text-fg-muted">{t("onboarding.handoff.resumeHint")}</p>

      <Link href={NEXT_ROUTE[track]} className="w-full">
        <Button className="w-full">{t("onboarding.continue")}</Button>
      </Link>
    </Card>
  );
}
