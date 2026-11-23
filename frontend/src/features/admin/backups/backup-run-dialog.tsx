"use client";

import { useI18n } from "@/lib/i18n/context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, LabeledField, Textarea } from "@/components/ui/controls";
import { PlayIcon, RefreshIcon } from "@/components/ui/icons";
import { requestBackupAction, refreshBackupRunsAction } from "@/server/actions/admin-backups";
import type { BackupEnvironment, BackupKind } from "@/server/queries/admin-backups";
import { useActionState } from "react";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/**
 * "Back up now" / "Run a restore test". Presentation only: the server action
 * re-derives the actor and the environment, the database re-checks the
 * permission, and the current-password receipt is bound to the environment.
 */
export function BackupRunDialog({
  kind,
  environment,
  productionEnabled,
  canRun,
}: {
  kind: BackupKind;
  environment: BackupEnvironment;
  productionEnabled: boolean;
  canRun: boolean;
}) {
  const { t } = useI18n();
  const isBackup = kind === "backup";
  const productionBlocked = environment === "production" && !productionEnabled;

  return (
    <ConfirmDialog
      trigger={t(isBackup ? "backups.run.backup" : "backups.run.restoreTest")}
      triggerVariant="outline"
      triggerIcon={isBackup ? <PlayIcon size={16} /> : <RefreshIcon size={16} />}
      title={t(isBackup ? "backups.run.backupTitle" : "backups.run.restoreTitle")}
      body={t(isBackup ? "backups.run.backupBody" : "backups.run.restoreBody")}
      confirmLabel={t(isBackup ? "backups.run.backup" : "backups.run.restoreTest")}
      confirmVariant="accent"
      formAction={requestBackupAction}
      confirmDisabled={!canRun || productionBlocked}
    >
      <input type="hidden" name="kind" value={kind} />
      {productionBlocked ? <p className="text-body text-warning">{t("backups.errors.productionOff")}</p> : null}
      {isBackup && environment === "production" ? (
        <LabeledField label={t("backups.run.confirmation")} htmlFor={`backup-confirm-${kind}`} hint={t("backups.run.confirmationHint")}>
          <Input id={`backup-confirm-${kind}`} name="confirmation" dir="ltr" autoComplete="off" required placeholder="back up production" />
        </LabeledField>
      ) : null}
      <LabeledField label={t("backups.run.password")} htmlFor={`backup-password-${kind}`} hint={t("backups.run.passwordHint")}>
        <Input id={`backup-password-${kind}`} name="password" type="password" autoComplete="current-password" required />
      </LabeledField>
      <LabeledField label={t("backups.run.reason")} htmlFor={`backup-reason-${kind}`} hint={t("backups.run.reasonHint")}>
        <Textarea id={`backup-reason-${kind}`} name="reason" rows={3} required minLength={10} maxLength={500} dir="auto" />
      </LabeledField>
    </ConfirmDialog>
  );
}

/** Re-reads GitHub for in-flight runs. Never dispatches a workflow. */
export function BackupRefreshButton() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(refreshBackupRunsAction, INITIAL);
  return (
    <form action={dispatch} className="flex flex-col gap-1">
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-sm border border-strong px-2.5 py-1.5 text-label font-medium text-fg hover:bg-surface-2"
      >
        <RefreshIcon size={14} />
        {t("backups.refresh.button")}
      </button>
      {state.code ? (
        <span role="status" className={state.ok ? "text-label text-success" : "text-label text-danger"}>
          {t(state.code)}
        </span>
      ) : null}
    </form>
  );
}
