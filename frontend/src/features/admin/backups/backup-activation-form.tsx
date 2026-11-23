"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import { setProductionBackupActivationAction } from "@/server/actions/admin-backups";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/**
 * The Production-only activation switch. Turning it OFF is immediate; turning it
 * ON requires the typed phrase AND a current-password receipt. The database
 * enforces both, so a crafted request cannot skip them.
 */
export function BackupActivationForm({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(setProductionBackupActivationAction, INITIAL);
  const next = !enabled;
  const phrase = next ? "activate production backups" : "deactivate production backups";

  return (
    <Card>
      <SectionTitle>{t("backups.activation.title")}</SectionTitle>
      <p className="mt-xs text-label text-fg-muted">{t("backups.activation.description")}</p>
      <p className="mt-sm text-body text-fg">
        {t("backups.activation.current")}: <strong>{t(enabled ? "backups.activation.on" : "backups.activation.off")}</strong>
      </p>
      {!canManage ? <p className="mt-md text-body text-fg-secondary">{t("backups.viewOnly")}</p> : null}
      <form action={dispatch} className="mt-md flex flex-col gap-md" data-testid="backup-activation-form">
        <input type="hidden" name="enabled" value={String(next)} />
        <LabeledField
          label={t(next ? "backups.activation.confirmOn" : "backups.activation.confirmOff")}
          htmlFor="backup-activation-confirmation"
          hint={t("backups.activation.confirmationHint", { phrase })}
        >
          <Input id="backup-activation-confirmation" name="confirmation" dir="ltr" autoComplete="off" required placeholder={phrase} disabled={!canManage} />
        </LabeledField>
        <LabeledField label={t("backups.activation.password")} htmlFor="backup-activation-password" hint={t("backups.activation.passwordHint")}>
          <Input id="backup-activation-password" name="password" type="password" autoComplete="current-password" required disabled={!canManage} />
        </LabeledField>
        <LabeledField label={t("backups.activation.reason")} htmlFor="backup-activation-reason" hint={t("backups.activation.reasonHint")}>
          <Textarea id="backup-activation-reason" name="reason" rows={3} required minLength={10} maxLength={500} dir="auto" disabled={!canManage} />
        </LabeledField>
        {state.code ? (
          <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid="backup-activation-message">
            {t(state.code)}
          </p>
        ) : null}
        {canManage ? (
          <SubmitButton variant={next ? "accent" : "danger"} pendingLabel={t("backups.activation.saving")} className="self-start">
            {t(next ? "backups.activation.turnOn" : "backups.activation.turnOff")}
          </SubmitButton>
        ) : null}
      </form>
    </Card>
  );
}
