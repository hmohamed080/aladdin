"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { AuthCard } from "@/features/auth/auth-card";
import { Button } from "@/components/ui/controls";
import { signOut } from "@/server/actions/auth";

/**
 * The suspended-account message (PD-010). Says the account and data are kept,
 * never shows the internal Admin reason, and offers support and sign-out.
 */
export function SuspendedPanel() {
  const { t } = useI18n();
  return (
    <AuthCard
      title={t("auth.suspended.title")}
      subtitle={t("auth.suspended.subtitle")}
      footer={
        <Link href="/auth/support" className="text-fg-muted hover:text-fg hover:underline">
          {t("auth.suspended.contactSupport")}
        </Link>
      }
    >
      <div className="flex flex-col gap-md">
        <p className="text-body text-fg-secondary">{t("auth.suspended.body")}</p>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            {t("common.signOut")}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
