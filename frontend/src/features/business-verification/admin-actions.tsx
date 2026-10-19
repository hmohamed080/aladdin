"use client";

import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { BV_REASON_MAX } from "@/lib/business-verification/contract";
import { approveBvAction, rejectBvAction, requestBvInfoAction, startBvReviewAction } from "@/server/actions/business-verification";

/**
 * Review controls for one business verification request. `canReview` / `canDecide` come from
 * `business_verification_detail` (the database's own answer for this caller) and only decide which buttons
 * are drawn; each RPC re-checks authority, the own-organization guard and the state machine. Every decision
 * carries a mandatory reason.
 */
export function BvAdminActions({
  id,
  status,
  canReview,
  canDecide,
}: {
  id: string;
  status: string;
  canReview: boolean;
  canDecide: boolean;
}) {
  const { t } = useI18n();
  const open = status === "pending" || status === "under_review";
  if (!canReview || !open) return null;

  const reasonField = (label: string, fieldId: string) => (
    <div className="mt-md">
      <input type="hidden" name="id" value={id} />
      <LabeledField label={label} htmlFor={fieldId}>
        <Textarea id={fieldId} name="reason" rows={3} required maxLength={BV_REASON_MAX} dir="auto" />
      </LabeledField>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-sm" data-testid="bv-admin-actions">
      {status === "pending" ? (
        <ConfirmDialog
          trigger={t("businessVerification.admin.actions.start")}
          triggerVariant="outline"
          title={t("businessVerification.admin.actions.startTitle")}
          body={t("businessVerification.admin.actions.startBody")}
          confirmLabel={t("businessVerification.admin.actions.start")}
          confirmVariant="primary"
          formAction={startBvReviewAction}
        >
          <input type="hidden" name="id" value={id} />
        </ConfirmDialog>
      ) : null}
      {status === "under_review" ? (
      <ConfirmDialog
        trigger={t("businessVerification.admin.actions.requestInfo")}
        triggerVariant="outline"
        title={t("businessVerification.admin.actions.requestInfoTitle")}
        confirmLabel={t("businessVerification.admin.actions.requestInfo")}
        confirmVariant="primary"
        formAction={requestBvInfoAction}
      >
        {reasonField(t("businessVerification.admin.actions.reasonLabel"), "bv-info-reason")}
      </ConfirmDialog>
      ) : null}
      {canDecide ? (
        <>
          <ConfirmDialog
            trigger={t("businessVerification.admin.actions.approve")}
            triggerVariant="accent"
            title={t("businessVerification.admin.actions.approveTitle")}
            body={t("businessVerification.admin.actions.approveBody")}
            confirmLabel={t("businessVerification.admin.actions.approve")}
            confirmVariant="accent"
            formAction={approveBvAction}
          >
            {reasonField(t("businessVerification.admin.actions.approveNoteLabel"), "bv-approve-reason")}
          </ConfirmDialog>
          <ConfirmDialog
            trigger={t("businessVerification.admin.actions.reject")}
            triggerVariant="danger"
            title={t("businessVerification.admin.actions.rejectTitle")}
            confirmLabel={t("businessVerification.admin.actions.reject")}
            confirmVariant="danger"
            formAction={rejectBvAction}
          >
            {reasonField(t("businessVerification.admin.actions.reasonLabel"), "bv-reject-reason")}
          </ConfirmDialog>
        </>
      ) : null}
    </div>
  );
}
