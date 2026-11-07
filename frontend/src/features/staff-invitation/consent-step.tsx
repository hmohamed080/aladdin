"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Checkbox, SubmitButton } from "@/components/ui/controls";
import { recordStaffConsentAction, type StaffInvitationState } from "@/server/actions/staff-invitation";

/**
 * Recovery step for an invitee whose consent receipts are not on record (an interrupted registration, or a recording failure). Staff access is
 * never granted without the current terms, privacy and pilot receipts, so this is shown instead of the Accept button until they exist. The
 * action re-reads the receipts from the database before it reports success.
 */
export function StaffConsentStep() {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  const [state, submit] = useActionState(recordStaffConsentAction, { ok: false } as StaffInvitationState);
  return (
    <form action={submit} className="flex flex-col gap-md" data-staff-invitation="consent">
      <p className="text-body text-fg-secondary">{t("staffInvitation.consent.body")}</p>
      <Checkbox id="staff-consent-agree" name="consent_agree" checked={agreed} onChange={setAgreed}>
        {t("authPasswordPreview.signUp.agreementPrefix")}{" "}
        <Link href="/legal/terms" target="_blank" className="font-semibold hover:underline">
          {t("entryAuth.terms")}
        </Link>{" "}
        {t("entryAuth.and")}{" "}
        <Link href="/legal/privacy" target="_blank" className="font-semibold hover:underline">
          {t("entryAuth.privacy")}
        </Link>
        . {t("authPasswordPreview.signUp.agreementSuffix")}
      </Checkbox>
      {state.code && !state.ok ? (
        <p role="alert" className="text-label text-danger">
          {t(state.code)}
        </p>
      ) : null}
      <SubmitButton className="w-full" disabled={!agreed} pendingLabel={t("staffInvitation.consent.saving")}>
        {t("staffInvitation.consent.submit")}
      </SubmitButton>
    </form>
  );
}
