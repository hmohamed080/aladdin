"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, LabeledField, Textarea } from "@/components/ui/controls";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { approveVerificationAction, rejectVerificationAction } from "@/server/actions/admin-forms";
import type { PendingUserVerification } from "@/server/queries/admin-directory";

/**
 * Approve / Reject for ONE user's or organization's open verification request, on the Users directory row (`compact` icon
 * buttons) and on the user page (labelled buttons). It is a thin shell over the SAME server actions the
 * Verifications queue uses (`approveVerificationAction` / `rejectVerificationAction`): they re-read the request
 * from the database, auto-claim the review, call the `review_*` RPCs (permission, no-self-review, sticky
 * reviewer, state machine) and run the idempotent apply step. Nothing is decided here.
 *
 * `ConfirmDialog` supplies the states: the confirm button shows a pending label and cannot be double-clicked,
 * an error stays in the dialog as an alert (a rejection keeps its typed reason), and success shows a toast,
 * refreshes the server data and closes. The rejection reason is optional (shown to the account owner when given).
 *
 * With no open request the controls stay visible but disabled, with the reason as their tooltip — the account
 * is not "verifiable" by an admin until the person has submitted something to review. (Phone / WhatsApp OTP
 * verification is a different mechanism and is never touched here.)
 */
export function UserVerificationControls({
  subjectId,
  pending,
  compact = false,
  subjectType = "user",
  canInitiate = false,
  recovery = false,
}: {
  /** The user or organization the request belongs to; only used to keep element ids unique. */
  subjectId: string;
  pending: PendingUserVerification | null;
  compact?: boolean;
  /** Which kind of subject `subjectId` is (only used when an Admin starts a verification). */
  subjectType?: "user" | "organization";
  /** The caller may start a verification for this subject (the database re-checks authority and eligibility). */
  canInitiate?: boolean;
  /**
   * RECOVERY: the request is already APPROVED but its apply step never completed. Only "Complete approval" is offered
   * (it resumes this exact request with its id); never Reject and never a new verification.
   */
  recovery?: boolean;
}) {
  const { t } = useI18n();
  // Public listing is the reviewer's explicit choice (ADR-0007 D14), only meaningful for a professional upgrade.
  // Ticked by default = the Verifications queue's behaviour; the dialog says what it does and nothing is hidden.
  const [listPublicly, setListPublicly] = useState(false);
  const offersListing = recovery ? false : pending ? pending.verificationType === "professional" : subjectType === "user";

  if (recovery && pending) {
    return (
      <ConfirmDialog
        trigger={t("admin.review.resume")}
        triggerVariant="accent"
        triggerIcon={compact ? <CheckIcon size={16} /> : undefined}
        triggerIconOnly={compact}
        triggerTone="success"
        title={t("admin.review.resumeTitle")}
        body={t("admin.review.resumeBody")}
        confirmLabel={t("admin.review.resume")}
        confirmVariant="accent"
        formAction={approveVerificationAction}
      >
        <input type="hidden" name="id" value={pending.id} />
      </ConfirmDialog>
    );
  }

  if (!pending && !canInitiate) {
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

  // With a request the decision targets it; without one the Admin's single click files it (through the authorized
  // admin_initiate_verification function) and decides it in the same action. No separate "Start" step.
  const hidden = pending ? (
    <input type="hidden" name="id" value={pending.id} />
  ) : (
    <>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
    </>
  );
  const reasonId = `verification-reason-${subjectId}`;

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
        {offersListing ? (
          <>
            <Checkbox id={`list-publicly-${subjectId}`} name="grantListing" checked={listPublicly} onChange={setListPublicly}>
              {t("admin.review.listPublicly")}
            </Checkbox>
            <p className="text-label text-fg-muted">{t("admin.review.listPubliclyHint")}</p>
          </>
        ) : null}
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
          <Textarea id={reasonId} name="reason" rows={3} maxLength={2000} />
        </LabeledField>
      </ConfirmDialog>
    </>
  );
}
