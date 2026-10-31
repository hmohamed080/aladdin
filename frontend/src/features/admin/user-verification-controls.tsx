"use client";

import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LabeledField, Textarea } from "@/components/ui/controls";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { approveVerificationAction, rejectVerificationAction } from "@/server/actions/admin-forms";
import type { PendingUserVerification } from "@/server/queries/admin-directory";

/**
 * Approve / Reject for ONE user's open verification request, on the Users directory row (`compact` icon
 * buttons) and on the user page (labelled buttons). It is a thin shell over the SAME server actions the
 * Verifications queue uses (`approveVerificationAction` / `rejectVerificationAction`): they re-read the request
 * from the database, auto-claim the review, call the `review_*` RPCs (permission, no-self-review, sticky
 * reviewer, state machine) and run the idempotent apply step. Nothing is decided here.
 *
 * `ConfirmDialog` supplies the states: the confirm button shows a pending label and cannot be double-clicked,
 * an error stays in the dialog as an alert (a rejection keeps its typed reason), and success shows a toast,
 * refreshes the server data and closes. A reason is required to reject, in the form and again in the action.
 *
 * With no open request the controls stay visible but disabled, with the reason as their tooltip — the account
 * is not "verifiable" by an admin until the person has submitted something to review. (Phone / WhatsApp OTP
 * verification is a different mechanism and is never touched here.)
 */
export function UserVerificationControls({
  userId,
  pending,
  compact = false,
}: {
  userId: string;
  pending: PendingUserVerification | null;
  compact?: boolean;
}) {
  const { t } = useI18n();

  if (!pending) {
    const cls = compact
      ? "grid h-8 w-8 shrink-0 cursor-not-allowed place-items-center rounded-sm text-fg-muted opacity-40"
      : "inline-flex min-h-10 cursor-not-allowed items-center gap-1.5 rounded-md border px-3.5 text-body font-medium text-fg-muted opacity-50";
    return (
      <>
        {(["approve", "reject"] as const).map((k) => (
          <span key={k} aria-disabled="true" role="button" title={t("admin.review.noPending")} aria-label={`${t(`admin.review.${k}`)} — ${t("admin.review.noPending")}`} className={cls}>
            {compact ? (k === "approve" ? <CheckIcon size={16} /> : <XIcon size={16} />) : t(`admin.review.${k}`)}
          </span>
        ))}
      </>
    );
  }

  const hidden = <input type="hidden" name="id" value={pending.id} />;
  const reasonId = `verification-reason-${userId}`;

  return (
    <>
      <ConfirmDialog
        trigger={t("admin.review.approve")}
        triggerVariant="accent"
        triggerIcon={compact ? <CheckIcon size={16} /> : undefined}
        triggerIconOnly={compact}
        triggerTone="success"
        title={t("admin.review.approveTitle")}
        body={t("admin.review.approveBody")}
        confirmLabel={t("admin.review.approve")}
        confirmVariant="accent"
        formAction={approveVerificationAction}
      >
        {hidden}
      </ConfirmDialog>
      <ConfirmDialog
        trigger={t("admin.review.reject")}
        triggerVariant="danger"
        triggerIcon={compact ? <XIcon size={16} /> : undefined}
        triggerIconOnly={compact}
        triggerTone="danger"
        title={t("admin.review.rejectTitle")}
        body={t("admin.review.rejectBody")}
        confirmLabel={t("admin.review.confirmReject")}
        confirmVariant="danger"
        formAction={rejectVerificationAction}
      >
        {hidden}
        <LabeledField label={t("admin.review.reasonPlaceholder")} htmlFor={reasonId}>
          <Textarea id={reasonId} name="reason" rows={3} maxLength={500} required />
        </LabeledField>
      </ConfirmDialog>
    </>
  );
}
