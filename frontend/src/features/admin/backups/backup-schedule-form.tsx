"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { Checkbox, Input, LabeledField, Select, SubmitButton, Textarea } from "@/components/ui/controls";
import { saveBackupScheduleAction } from "@/server/actions/admin-backups";
import type { BackupEnvironment, BackupSettings } from "@/server/queries/admin-backups";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/**
 * The schedule form. The version the admin SAW is submitted; a stale version is
 * refused. The environment (and therefore the re-authentication target) is read
 * from the database by the action, never from this form.
 */
export function BackupScheduleForm({
  environment,
  settings,
  canManage,
}: {
  environment: BackupEnvironment;
  settings: BackupSettings;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(saveBackupScheduleAction, INITIAL);
  const [restore, setRestore] = useState(settings.production_restore_schedule_enabled);

  return (
    <Card>
      <SectionTitle>{t("backups.schedule.title")}</SectionTitle>
      <p className="mt-xs text-label text-fg-muted">{t("backups.schedule.description")}</p>
      {!canManage ? <p className="mt-md text-body text-fg-secondary">{t("backups.viewOnly")}</p> : null}
      <form action={dispatch} className="mt-md flex flex-col gap-md" data-testid="backup-schedule-form">
        <input type="hidden" name="version" value={settings.version} />
        <div className="grid gap-md sm:grid-cols-2">
          <LabeledField label={t("backups.schedule.acceptance")} htmlFor="backup-acceptance-schedule" hint={t("backups.schedule.acceptanceHint")}>
            <Select id="backup-acceptance-schedule" name="acceptance_schedule" defaultValue={settings.acceptance_schedule} disabled={!canManage}>
              <option value="off">{t("backups.schedule.off")}</option>
              <option value="daily">{t("backups.schedule.daily")}</option>
              <option value="weekly">{t("backups.schedule.weekly")}</option>
            </Select>
          </LabeledField>
          {environment === "production" ? (
            <div className="flex flex-col gap-2">
              <span className="text-label font-medium text-fg">{t("backups.schedule.productionRestore")}</span>
              <fieldset disabled={!canManage || !settings.production_enabled} className="contents">
                <Checkbox
                  id="backup-production-restore"
                  name="production_restore_schedule_enabled"
                  checked={restore}
                  onChange={setRestore}
                >
                  {t("backups.schedule.productionRestoreLabel")}
                </Checkbox>
              </fieldset>
              <span className="text-label text-fg-muted">{t("backups.schedule.productionRestoreHint")}</span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-md sm:grid-cols-2">
          <LabeledField label={t("backups.schedule.time")} htmlFor="backup-time">
            <Input id="backup-time" name="schedule_time" type="time" defaultValue={settings.schedule_time.slice(0,5)} required disabled={!canManage} />
          </LabeledField>
          <LabeledField label={t("backups.schedule.weekday")} htmlFor="backup-weekday">
            <Select id="backup-weekday" name="schedule_weekday" defaultValue={settings.schedule_weekday} disabled={!canManage}>
              {[0,1,2,3,4,5,6].map(day => <option key={day} value={day}>{t(`backups.schedule.day${day}`)}</option>)}
            </Select>
          </LabeledField>
          <LabeledField label={t("backups.schedule.pause")} htmlFor="backup-pause">
            <Select id="backup-pause" name="pause_hours" defaultValue="0" disabled={!canManage}>
              <option value="0">{t("backups.schedule.resume")}</option>
              {[1,6,24,72,168].map(hours => <option key={hours} value={hours}>{t("backups.schedule.pauseHours", {hours})}</option>)}
            </Select>
          </LabeledField>
        </div>
        {settings.paused_until ? <p role="status">{t("backups.schedule.pausedUntil", {time: settings.paused_until})}</p> : null}
        {environment === "production" ? <LabeledField label={t("backups.run.confirmation")} htmlFor="backup-schedule-confirm">
          <Input id="backup-schedule-confirm" name="confirmation" placeholder="change production schedule" required disabled={!canManage} />
        </LabeledField> : null}
        <LabeledField label={t("backups.schedule.password")} htmlFor="backup-schedule-password" hint={t("backups.schedule.passwordHint")}>
          <Input id="backup-schedule-password" name="password" type="password" autoComplete="current-password" required disabled={!canManage} />
        </LabeledField>
        <LabeledField label={t("backups.schedule.reason")} htmlFor="backup-schedule-reason" hint={t("backups.schedule.reasonHint")}>
          <Textarea id="backup-schedule-reason" name="reason" rows={3} required minLength={10} maxLength={500} dir="auto" disabled={!canManage} />
        </LabeledField>
        <p className="text-label text-fg-muted">{t("backups.schedule.versionNote", { version: settings.version })}</p>
        {state.code ? (
          <p role="status" className={state.ok ? "text-body text-success" : "text-body text-danger"} data-testid="backup-schedule-message">
            {t(state.code)}
          </p>
        ) : null}
        {canManage ? (
          <SubmitButton pendingLabel={t("backups.schedule.saving")} className="self-start">
            {t("backups.schedule.save")}
          </SubmitButton>
        ) : null}
      </form>
    </Card>
  );
}
