"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { SubmitButton } from "@/components/ui/controls";
import { checkWhatsappOtpAlertPathAction } from "@/server/actions/whatsapp-otp-settings";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/** Super Admin only (the page renders it for whatsapp_otp.manage; the action re-checks). A diagnostic: it never changes a setting. */
export function WhatsappOtpNotifyCheck() {
  const { t } = useI18n();
  const [state, formAction] = useActionState(checkWhatsappOtpAlertPathAction, INITIAL);
  return (
    <form action={formAction} className="mt-md flex flex-wrap items-center gap-sm" data-testid="whatsapp-otp-notify-check">
      <SubmitButton pendingLabel={t("whatsappOtp.notifyCheck.running")}>{t("whatsappOtp.notifyCheck.button")}</SubmitButton>
      {state.code ? (
        <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid="whatsapp-otp-notify-check-result">
          {t(state.code)}
        </p>
      ) : null}
    </form>
  );
}
