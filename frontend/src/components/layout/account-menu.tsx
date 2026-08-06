"use client";

import { useI18n } from "@/lib/i18n/context";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/controls";
import { LogOutIcon } from "@/components/ui/icons";

/**
 * Minimal account area: the active organization name + a sign-out action. It
 * deliberately does NOT offer a role/profile switcher — one canonical identity;
 * navigation is derived from memberships (PRODUCT_DIRECTION_GUIDE).
 */
export function AccountMenu({ orgName }: { orgName: string }) {
  return (
    <div className="flex items-center gap-sm">
      <span className="hidden max-w-40 truncate text-label font-medium text-fg-secondary desktop:inline">
        {orgName}
      </span>
      <SignOutButton />
    </div>
  );
}

/** Sign-out control (form + server action), reused across the shell chrome. */
export function SignOutButton() {
  const { t } = useI18n();
  return (
    <form action={signOut}>
      <Button type="submit" variant="outline" size="sm" aria-label={t("common.signOut")}>
        <LogOutIcon size={16} />
        <span className="hidden tablet:inline">{t("common.signOut")}</span>
      </Button>
    </form>
  );
}
