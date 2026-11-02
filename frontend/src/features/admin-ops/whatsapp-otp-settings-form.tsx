"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import { saveWhatsappOtpSettingsAction } from "@/server/actions/whatsapp-otp-settings";
import type { FormState } from "@/server/actions/sales-forms";

type Values = { daily_limit: number; hard_ceiling: number; warn_percent: number; critical_percent: number };

const INITIAL: FormState = { ok: false };

/**
 * The Super Admin form. Presentation only: the server action re-derives the actor and permissions from the session, re-reads the current
 * settings from the Worker, and the database and the Worker validate again. `version` is the one the admin SAW; a stale one is refused.
 * Changing the Hard Ceiling asks for the new number to be typed again and for a longer reason.
 */
export function WhatsappOtpSettingsForm({ version, values, canManageCeiling }: { version: number; values: Values | null; canManageCeiling: boolean }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(saveWhatsappOtpSettingsAction, INITIAL);
  const [ceiling, setCeiling] = useState(String(values?.hard_ceiling ?? ""));
  const ceilingChanged = values === null || String(values.hard_ceiling) !== ceiling.trim();

  return (
    <Card>
      <SectionTitle>{t("whatsappOtp.form.title")}</SectionTitle>
      <form action={formAction} className="mt-md flex flex-col gap-md" data-testid="whatsapp-otp-form">
        <input type="hidden" name="version" value={version} />
        <div className="grid gap-md sm:grid-cols-2">
          <LabeledField label={t("whatsappOtp.form.dailyLimit")} htmlFor="otp-daily" hint={t("whatsappOtp.form.dailyLimitHint")}>
            <Input id="otp-daily" name="daily_limit" inputMode="numeric" dir="ltr" required pattern="[0-9]{1,7}" defaultValue={values?.daily_limit ?? ""} />
          </LabeledField>
          <LabeledField label={t("whatsappOtp.form.hardCeiling")} htmlFor="otp-ceiling" hint={t("whatsappOtp.form.hardCeilingHint")}>
            <Input
              id="otp-ceiling"
              name="hard_ceiling"
              inputMode="numeric"
              dir="ltr"
              required
              pattern="[0-9]{1,7}"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              disabled={!canManageCeiling && values !== null}
              readOnly={!canManageCeiling && values !== null}
            />
          </LabeledField>
          <LabeledField label={t("whatsappOtp.form.warn")} htmlFor="otp-warn">
            <Input id="otp-warn" name="warn_percent" inputMode="numeric" dir="ltr" required pattern="[0-9]{1,3}" defaultValue={values?.warn_percent ?? ""} />
          </LabeledField>
          <LabeledField label={t("whatsappOtp.form.critical")} htmlFor="otp-critical">
            <Input id="otp-critical" name="critical_percent" inputMode="numeric" dir="ltr" required pattern="[0-9]{1,3}" defaultValue={values?.critical_percent ?? ""} />
          </LabeledField>
        </div>
        {/* A disabled field is not submitted, so a read-only ceiling is carried by the readOnly input above (still sent, still verified server-side). */}
        {ceilingChanged && canManageCeiling ? (
          <LabeledField label={t("whatsappOtp.form.ceilingConfirm", { value: ceiling.trim() || "…" })} htmlFor="otp-ceiling-confirm">
            <Input id="otp-ceiling-confirm" name="ceiling_confirmation" inputMode="numeric" dir="ltr" autoComplete="off" required />
          </LabeledField>
        ) : null}
        <LabeledField label={t("whatsappOtp.form.reason")} htmlFor="otp-reason" hint={t("whatsappOtp.form.reasonHint")}>
          <Textarea id="otp-reason" name="reason" rows={3} required minLength={10} maxLength={500} dir="auto" />
        </LabeledField>
        <p className="text-label text-fg-muted">{t("whatsappOtp.form.note")}</p>
        {state.code ? (
          <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid="whatsapp-otp-message">
            {t(state.code)}
          </p>
        ) : null}
        <SubmitButton pendingLabel={t("whatsappOtp.form.saving")} className="self-start">
          {t("whatsappOtp.form.save")}
        </SubmitButton>
      </form>
    </Card>
  );
}
