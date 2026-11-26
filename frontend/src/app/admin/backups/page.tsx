import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/ui/format";
import { readBackupGithubEnv } from "@/lib/env/backups";
import { historyFilterFrom, latestRunTime, scheduleSummary } from "@/features/admin/backups/backup-view";
import { BackupHistory } from "@/features/admin/backups/backup-history";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { nextBackupAt } from "@/server/backups/schedule";
import { loadBackupRuns, loadBackupStatus } from "@/server/queries/admin-backups";
import { AdminHeader, StatTile } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { BackupRunDialog, BackupRefreshButton } from "@/features/admin/backups/backup-run-dialog";
import { BackupScheduleForm } from "@/features/admin/backups/backup-schedule-form";
import { BackupActivationForm } from "@/features/admin/backups/backup-activation-form";

export const dynamic = "force-dynamic";

/**
 * Backups. `backup.view` (Administrator and higher) opens the page; execution,
 * schedule changes and the Production activation appear only for the matching
 * permissions (Super Admin by default). The page is read-only on load: it never
 * dispatches a backup, never changes a setting and never calls GitHub.
 */
export default async function AdminBackupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminRoute("/admin/backups");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  // Results are recorded by the backup service itself when a run ends; opening the page never waits for GitHub.
  const status = await loadBackupStatus(supabase);
  if (!status) return <StatePanel tone="danger" title={t("backups.errors.forbidden")} />;

  const header = <AdminHeader locale={locale} title={t("backups.title")} subtitle={t("backups.subtitle")} />;

  if (!status.initialized || !status.environment) {
    return (
      <div className="flex flex-col gap-lg" data-testid="admin-backups">
        {header}
        <StatePanel tone="warning" title={t("backups.notInitialized.title")} body={t("backups.notInitialized.body")} />
      </div>
    );
  }

  const environment = status.environment;
  const nextRun = nextBackupAt(status.settings, environment);
  const canExecute = can(access, "backup.execute");
  const canRestore = can(access, "backup.restore_test");
  const canSchedule = can(access, "backup.schedule_manage");
  const canActivate = can(access, "backup.schedule_manage") && environment === "production";

  const params = await searchParams;
  const filter = historyFilterFrom(params);
  const history = await loadBackupRuns(supabase, filter);

  // Display names for the history. RLS decides what this administrator may read; the id prefix is the fallback.
  const actorIds = [...new Set((history?.runs ?? []).map((r) => r.requested_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const row of data ?? []) names.set(row.user_id, row.display_name);
  }
  const who = (id: string | null) => (id ? names.get(id) || id.slice(0, 8) : "—");
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso).toISOString(), locale) : "—");

  const summary = scheduleSummary(status.settings, environment);
  const scheduleLabel = {
    inactive: () => t("backups.schedule.productionOff"),
    off: () => t("backups.schedule.off"),
    paused: () => t("backups.schedule.summaryPaused"),
    daily: () => t("backups.schedule.summaryDaily", { time: summary.time }),
    weekly: () => t("backups.schedule.summaryWeekly", { day: t(`backups.schedule.day${summary.weekday ?? 0}`), time: summary.time }),
  }[summary.state]();

  const repo = readBackupGithubEnv().BACKUP_GITHUB_REPO;
  const latestTime = (outcome: NonNullable<typeof status.latest.backup>) => when(latestRunTime(outcome, status.runs));

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-backups">
      {header}

      <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
        <StatTile locale={locale} label={t("backups.overview.environment")} value={t(`backups.environment.${environment}`)} />
        <StatTile
          locale={locale}
          label={t("backups.overview.lastBackup")}
          value={status.latest.backup ? latestTime(status.latest.backup) : t("backups.overview.never")}
          hint={status.latest.backup?.github_run_id ? `#${status.latest.backup.github_run_id}` : undefined}
        />
        <StatTile
          locale={locale}
          label={t("backups.overview.lastRestoreTest")}
          value={status.latest.restore_test ? latestTime(status.latest.restore_test) : t("backups.overview.never")}
        />
        <StatTile
          locale={locale}
          label={t("backups.overview.schedule")}
          value={scheduleLabel}
          hint={t("backups.overview.version", { version: status.settings.version })}
        />
      </div>

      {status.latest.last_failure ? (
        <StatePanel tone="danger" title={t("backups.overview.lastFailure")} body={t("backups.overview.lastFailureBody", {
            kind: t(status.latest.last_failure.kind === "restore_test" ? "backups.history.kindRestoreTest" : "backups.history.kindBackup"),
            when: latestTime(status.latest.last_failure),
            code: status.latest.last_failure.code ?? t("backups.overview.unknownCode"),
          })} />
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <SectionTitle>{t("backups.run.title")}</SectionTitle>
          <BackupRefreshButton />
        </div>
        <p className="mt-xs text-label text-fg-muted">{t("backups.run.description")}</p>
        {canExecute || canRestore ? (
          <div className="mt-md flex flex-wrap gap-sm">
            {canExecute ? (
              <BackupRunDialog kind="backup" environment={environment} productionEnabled={status.settings.production_enabled} canRun={canExecute} />
            ) : null}
            {canRestore ? (
              <BackupRunDialog
                kind="restore_test"
                environment={environment}
                productionEnabled={status.settings.production_enabled}
                canRun={canRestore}
              />
            ) : null}
          </div>
        ) : (
          <p className="mt-md text-body text-fg-secondary">{t("backups.viewOnly")}</p>
        )}
      </Card>

      <BackupScheduleForm key={status.settings.version} environment={environment} settings={status.settings} canManage={canSchedule} />

      <Card>
        <SectionTitle>{t("backups.overview.coverage")}</SectionTitle>
        <p className="mt-sm text-body text-fg-secondary">{t("backups.overview.coverageHint")}</p>
        <p className="mt-sm text-body">{t("backups.overview.nextRun", {time: nextRun ? when(nextRun) : t("backups.schedule.off")})}</p>
        <p className="mt-sm text-body text-fg-secondary">{t("backups.overview.retryHint")}</p>
      </Card>

      <BackupHistory result={history} filter={filter} t={t} who={who} when={when} repo={repo} />

      {/* The go-live master switch: used once, so it sits closed at the bottom while Production is active. */}
      {environment === "production" ? (
        <details open={!status.settings.production_enabled} data-testid="backup-activation-section">
          <summary className="cursor-pointer text-label font-medium text-fg-secondary">
            {t(status.settings.production_enabled ? "backups.activation.advancedOn" : "backups.activation.advancedOff")}
          </summary>
          <div className="mt-sm">
            <BackupActivationForm enabled={status.settings.production_enabled} canManage={canActivate} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
