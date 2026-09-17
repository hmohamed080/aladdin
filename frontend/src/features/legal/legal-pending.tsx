"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/primitives";
import { Brand } from "@/components/layout/brand";

/**
 * Honest placeholder for Terms of Service / Privacy Policy. Per the approved
 * legal-content direction: public production registration must never launch
 * with placeholder legal text, but the ROUTE and an honest "not yet published"
 * state may exist now so links (footer, consent flow) have somewhere real to
 * go before the actual reviewed content is supplied. Never presented as if it
 * were the real policy.
 */
export function LegalPending({ titleKey }: { titleKey: "terms" | "privacy" }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-lg px-md py-xl">
      <Card className="flex flex-col gap-md">
        <Brand name={t("common.appName")} size="sm" />
        <h1 className="font-display-ar text-headline text-fg">{t(`legal.${titleKey}.title`)}</h1>
        <p className="text-label font-medium uppercase tracking-wide text-warning">{t("legal.pendingTitle")}</p>
        <p className="text-body-lg text-fg-secondary">{t("legal.pendingBody")}</p>
        <Link href="/" className="text-label font-medium text-accent hover:underline">
          {t("legal.backToHome")}
        </Link>
      </Card>
    </div>
  );
}
