"use client";

import { useI18n } from "@/lib/i18n/context";
import { archiveCustomerAction } from "@/server/actions/sales-forms";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Archive a customer behind an explicit confirmation with a clear consequence. */
export function ArchiveCustomerButton({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("common.archive")}
      title={t("confirm.archiveCustomerTitle")}
      body={t("confirm.archiveCustomerBody")}
      confirmLabel={t("common.archive")}
      action={archiveCustomerAction}
    >
      <input type="hidden" name="customerId" value={customerId} />
    </ConfirmDialog>
  );
}
