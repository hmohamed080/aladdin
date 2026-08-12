"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { StatePanel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { BuildingIcon, PlusIcon } from "@/components/ui/icons";

/**
 * The account-safe terminal for a caller who has no usable workspace at all —
 * no personal persona and no active membership (typically a business-only
 * identity whose only membership was just revoked).
 *
 * It deliberately renders instead of redirecting: every other destination would
 * bounce them straight back here. Their identity is intact and they can create a
 * business immediately; nothing about their account has been deleted or downgraded.
 */
export function NoPersonalWorkspace() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-md py-xl" data-testid="no-personal-workspace">
      <StatePanel
        icon={<BuildingIcon size={22} />}
        title={t("workspace.none.title")}
        body={t("workspace.none.body")}
        tone="warning"
      />
      <Link href="/business/new">
        <Button type="button" variant="primary">
          <PlusIcon size={16} />
          {t("workspace.addBusiness")}
        </Button>
      </Link>
    </div>
  );
}
