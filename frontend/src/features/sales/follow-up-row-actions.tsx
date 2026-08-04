"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { SubmitButton } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  completeFollowUpAction,
  reopenFollowUpAction,
  cancelFollowUpAction,
} from "@/server/actions/sales-forms";

/**
 * Per-follow-up lifecycle controls shared by the lead/customer detail lists.
 * Open → Edit + Complete + Cancel(confirm); Completed → Reopen. Cancel is a
 * terminal action so it goes behind an explicit confirmation. Lifecycle runs
 * through the trusted RPCs; the hidden lead/customer id lets the server
 * revalidate the right detail page.
 */
export function FollowUpRowActions({
  id,
  status,
  leadId,
  customerId,
  canEdit,
}: {
  id: string;
  status: string;
  leadId?: string | null;
  customerId?: string | null;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  if (!canEdit) return null;

  const hidden = (
    <>
      <input type="hidden" name="followUpId" value={id} />
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
    </>
  );

  if (status === "open") {
    return (
      <span className="flex flex-wrap items-center gap-sm">
        <Link href={`/b2b/follow-ups/${id}/edit`} className="text-label text-accent hover:underline">
          {t("followUps.edit")}
        </Link>
        <form action={completeFollowUpAction}>
          {hidden}
          <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
            {t("followUps.complete")}
          </SubmitButton>
        </form>
        <ConfirmDialog
          trigger={t("followUps.cancel")}
          triggerVariant="ghost"
          title={t("confirm.cancelFollowUpTitle")}
          body={t("confirm.cancelFollowUpBody")}
          confirmLabel={t("followUps.cancel")}
          action={cancelFollowUpAction}
        >
          {hidden}
        </ConfirmDialog>
      </span>
    );
  }
  if (status === "completed") {
    return (
      <form action={reopenFollowUpAction}>
        {hidden}
        <SubmitButton variant="outline" pendingLabel={t("common.saving")}>
          {t("followUps.reopen")}
        </SubmitButton>
      </form>
    );
  }
  return null;
}
