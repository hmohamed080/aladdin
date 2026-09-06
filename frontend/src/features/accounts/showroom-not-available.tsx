"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { StatePanel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { StorefrontIcon } from "@/components/ui/icons";

/**
 * The account-safe terminal for a personal account that is not a Salesperson
 * reaching a Sales-setup route directly.
 *
 * It RENDERS rather than redirects, for the same reason `NoPersonalWorkspace`
 * does: a redirect would bounce someone who typed a real URL somewhere they did
 * not ask to go, with no explanation of why. Nothing about their account is wrong
 * — connecting to a showroom simply belongs to a different account type — so the
 * copy says that plainly and offers the way back.
 *
 * The database refuses these flows for a non-Sales persona regardless
 * (`app.is_sales_persona`). This panel exists so that refusal is never met as a
 * failed form submission.
 */
export function ShowroomNotAvailable() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-md py-xl" data-testid="showroom-not-available">
      <StatePanel
        icon={<StorefrontIcon size={22} />}
        title={t("showroom.notSales.title")}
        body={t("showroom.notSales.body")}
      />
      <Link href="/home">
        <Button type="button" variant="outline">
          {t("showroom.notSales.back")}
        </Button>
      </Link>
    </div>
  );
}
