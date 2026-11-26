import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/session";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime, formatNumber } from "@/lib/ui/format";
import { readBackupGithubEnv } from "@/lib/env/backups";
import { isSystemReason, latestRunTime, requesterOf, runTime, runUrl, scheduleSummary, splitSkipped } from "@/features/admin/backups/backup-view";
import { can } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import { reconcileBackupRuns } from "@/server/backups/reconcile";
import { nextBackupAt } from "@/server/backups/schedule";
import { loadBackupStatus, type BackupRun } from "@/server/queries/admin-backups";
import { AdminHeader, StatTile, TableScroll } from "@/features/admin/parts";
import { Badge, Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { BackupRunDialog, BackupRefreshButton } from "@/features/admin/backups/backup-run-dialog";
import { BackupScheduleForm } from "@/features/admin/backups/backup-schedule-form";
import { BackupActivationForm } from "@/features/admin/backups/backup-activation-form";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  succeeded: "success",
  failed: "danger",
  unknown: "danger",
  skipped: "neutral",
  running: "info",
  dispatched: "warning",
  requested: "warning",
} as const;

/**
 * Backups. `backup.view` (Administrator and higher) opens the page; execution,
 * schedule changes and the Production activation appear only for the matching
 * permissions (Super Admin by default). The page is read-only on load except for
 * a best-effort settlement of in-flight GitHub runs — it never dispatches a
 * backup and never changes a setting.
 */
export default async function AdminBackupsPage({ searchParams }: { searchParams: Promise<{ skipped?: string }> }) {
  const access = await requireAdminRoute("/admin/backups");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();

  const first = await loadBackupStatus(supabase);
  if (!first) return <StatePanel tone="danger" title={t("backups.errors.forbidden")} />;

  const user = await getCurrentUser();
  let status = first;
  if (user && first.initialized) {
    // Settle runs whose GitHub outcome is already final, then read the settled view. Best effort: a GitHub failure
    // leaves the run as it was and is never mistaken for success.
    await reconcileBackupRuns(first, user.id).catch(() => 0);
    status = (await loadBackupStatus(supabase)) ?? first;
  }

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

  // Display names for the history. RLS decides what this administrator may read; the id prefix is the fallback.
  const actorIds = [...new Set(status.runs.map((r) => r.requested_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
    for (const row of data ?? []) names.set(row.user_id, row.display_name);
  }
  const who = (id: string | null) => (id ? names.get(id) || id.slice(0, 8) : "—");
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso).toISOString(), locale) : "—");
  const n = (value: number) => formatNumber(value, locale);

  const summary = scheduleSummary(status.settings, environment);
  const scheduleLabel = {
    inactive: () => t("backups.schedule.productionOff"),
    off: () => t("backups.schedule.off"),
    paused: () => t("backups.schedule.summaryPaused"),
    daily: () => t("backups.schedule.summaryDaily", { time: summary.time }),
    weekly: () => t("backups.schedule.summaryWeekly", { day: t(`backups.schedule.day${summary.weekday ?? 0}`), time: summary.time }),
  }[summary.state]();

  const repo = readBackupGithubEnv().BACKUP_GITHUB_REPO;
  const includeSkipped = (await searchParams).skipped === "1";
  const { shown, skippedCount } = splitSkipped(status.runs, includeSkipped);
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <SectionTitle>{t("backups.history.title")}</SectionTitle>
          {skippedCount > 0 ? (
            <Link href={includeSkipped ? "/admin/backups" : "/admin/backups?skipped=1"} scroll={false} className="text-label text-accent underline underline-offset-2" data-testid="backup-skipped-toggle">
              {includeSkipped ? t("backups.history.hideSkipped") : t("backups.history.showSkipped", { count: n(skippedCount) })}
            </Link>
          ) : null}
        </div>
        {skippedCount > 0 ? <p className="mt-xs text-label text-fg-muted">{t("backups.history.skippedHint")}</p> : null}
        {shown.length === 0 ? (
          <p className="mt-md text-body text-fg-secondary">{t("backups.history.empty")}</p>
        ) : (
          <div className="mt-md">
            <TableScroll>
              <thead>
                <tr className="border-b text-start text-label text-fg-muted">
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.when")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.kind")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.trigger")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.statusLabel")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.requestedBy")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.reason")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("backups.history.github")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((run) => (
                  <HistoryRow key={run.id} run={run} t={t} who={who} when={when} repo={repo} />
                ))}
              </tbody>
            </TableScroll>
          </div>
        )}
      </Card>

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

function HistoryRow({
  run,
  t,
  who,
  when,
  repo,
}: {
  run: BackupRun;
  t: ReturnType<typeof createTranslator>;
  who: (id: string | null) => string;
  when: (iso: string | null) => string;
  repo: string;
}) {
  const url = runUrl(run, repo);
  const requester = {
    person: () => who(run.requested_by),
    system: () => t("backups.history.requestedBySystem"),
    github: () => t("backups.history.requestedByGithub"),
  }[requesterOf(run)]();
  return (
    <tr className="border-b last:border-b-0" data-testid="backup-run-row">
      <td className="px-3 py-2 text-fg-secondary">{when(runTime(run))}</td>
      <td className="px-3 py-2 text-fg">{t(run.kind === "restore_test" ? "backups.history.kindRestoreTest" : "backups.history.kindBackup")}</td>
      <td className="px-3 py-2 text-fg-secondary">{t(run.trigger === "schedule" ? "backups.history.triggerSchedule" : "backups.history.triggerManual")}</td>
      <td className="px-3 py-2">
        <Badge tone={STATUS_TONE[run.status]}>{t(`backups.history.status.${run.status}`)}</Badge>
        {run.error_code ? <span className="ms-1 text-label text-fg-muted" dir="ltr">{run.error_code}</span> : null}
      </td>
      <td className="px-3 py-2 text-fg-secondary">{requester}</td>
      <td className="max-w-[22rem] px-3 py-2 text-fg-secondary"><span dir="auto">{isSystemReason(run.reason) ? t("backups.history.systemReason") : run.reason}</span></td>
      <td className="px-3 py-2">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2" dir="ltr">
            #{run.github_run_id}
          </a>
        ) : (
          <span className="text-label text-fg-muted">{t("backups.history.noRunRecorded")}</span>
        )}
      </td>
    </tr>
  );
}
