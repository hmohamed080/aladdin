"use client";

import { useI18n } from "@/lib/i18n/context";
import { archiveCustomerAction } from "@/server/actions/sales-forms";
import { SubmitButton } from "@/components/ui/controls";

export function ArchiveCustomerButton({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  return (
    <form action={archiveCustomerAction}>
      <input type="hidden" name="customerId" value={customerId} />
      <SubmitButton variant="danger" pendingLabel={t("common.saving")}>
        {t("common.archive")}
      </SubmitButton>
    </form>
  );
}
