"use client";

import { useI18n } from "@/lib/i18n/context";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/controls";

/**
 * Minimal account area: the active organization name + a sign-out action. It
 * deliberately does NOT offer a role/profile switcher — one canonical identity;
 * navigation is derived from memberships (PRODUCT_DIRECTION_GUIDE).
 */
export function AccountMenu({ orgName }: { orgName: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-sm">
      <span className="hidden max-w-40 truncate text-label text-fg-secondary tablet:inline">
        {orgName}
      </span>
      <form action={signOut}>
        <Button type="submit" variant="outline" aria-label={t("common.signOut")}>
          {t("common.signOut")}
        </Button>
      </form>
    </div>
  );
}
