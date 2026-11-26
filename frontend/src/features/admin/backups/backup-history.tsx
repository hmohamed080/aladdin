import Link from "next/link";
import type { createTranslator } from "@/lib/i18n/translate";
import { TableScroll } from "@/features/admin/parts";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/ui/cn";
import type { BackupRun, BackupRunsFilter, BackupRunsPage } from "@/server/queries/admin-backups";
import { BACKUP_KINDS, BACKUP_STATUSES, historyHref, isSystemReason, pageCount, requesterOf, runTime, runUrl } from "./backup-view";

const STATUS_TONE = {
  succeeded: "success",
  failed: "danger",
  unknown: "danger",
  skipped: "neutral",
  running: "info",
  dispatched: "warning",
  requested: "warning",
} as const;

type Translate = ReturnType<typeof createTranslator>;
type Who = (id: string | null) => string;
type When = (iso: string | null) => string;

const kindKey = (kind: BackupRun["kind"]) => (kind === "restore_test" ? "backups.history.kindRestoreTest" : "backups.history.kindBackup");

/**
 * Run history, one server-read page at a time. Filters and pages are plain links, so the address is the state.
 * `result === null` is a failed read and is said as such: it must never look like an empty or lost history.
 */
export function BackupHistory({
  result,
  filter,
  t,
  who,
  when,
  repo,
}: {
  result: BackupRunsPage | null;
  filter: BackupRunsFilter;
  t: Translate;
  who: Who;
  when: When;
  repo: string;
}) {
  // Choosing a filter always starts at the first page.
  const choose = (over: Partial<BackupRunsFilter>) => historyHref({ ...filter, ...over, page: 1 });
  const pages = result ? pageCount(result.total, result.pageSize) : 1;
  const toPage = (page: number) => historyHref({ ...filter, page });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-sm" data-testid="backup-history">
        <SectionTitle>{t("backups.history.title")}</SectionTitle>
        {result && result.skippedTotal > 0 && filter.status === null ? (
          <Link href={choose({ includeSkipped: !filter.includeSkipped })} scroll={false} className="text-label text-accent underline underline-offset-2" data-testid="backup-skipped-toggle">
            {filter.includeSkipped ? t("backups.history.hideSkipped") : t("backups.history.showSkipped", { count: result.skippedTotal })}
          </Link>
        ) : null}
      </div>

      <div className="mt-sm flex flex-col gap-xs">
        <FilterRow label={t("backups.history.kind")}>
          <FilterLink testId="backup-filter-kind-all" href={choose({ kind: null })} active={filter.kind === null}>
            {t("backups.history.all")}
          </FilterLink>
          {BACKUP_KINDS.map((kind) => (
            <FilterLink key={kind} testId={`backup-filter-kind-${kind}`} href={choose({ kind })} active={filter.kind === kind}>
              {t(kindKey(kind))}
            </FilterLink>
          ))}
        </FilterRow>
        <FilterRow label={t("backups.history.statusLabel")}>
          <FilterLink testId="backup-filter-status-all" href={choose({ status: null })} active={filter.status === null}>
            {t("backups.history.all")}
          </FilterLink>
          {BACKUP_STATUSES.map((status) => (
            <FilterLink key={status} testId={`backup-filter-status-${status}`} href={choose({ status })} active={filter.status === status}>
              {t(`backups.history.status.${status}`)}
            </FilterLink>
          ))}
        </FilterRow>
      </div>

      {result && result.skippedTotal > 0 && filter.status === null ? <p className="mt-xs text-label text-fg-muted">{t("backups.history.skippedHint")}</p> : null}

      {!result ? (
        <p role="alert" className="mt-md text-body text-danger">{t("backups.history.loadError")}</p>
      ) : result.runs.length === 0 ? (
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
              {result.runs.map((run) => (
                <HistoryRow key={run.id} run={run} t={t} who={who} when={when} repo={repo} />
              ))}
            </tbody>
          </TableScroll>
        </div>
      )}

      {result && pages > 1 ? (
        <nav className="mt-md flex flex-wrap items-center justify-center gap-md" aria-label={t("backups.history.title")}>
          {result.page > 1 ? (
            <Link href={toPage(result.page - 1)} scroll={false} className="text-body text-accent underline underline-offset-2" data-testid="backup-history-previous">
              {t("backups.history.previous")}
            </Link>
          ) : null}
          <span className="text-label text-fg-muted" data-testid="backup-history-page">
            {t("backups.history.pageOf", { page: result.page, pages })}
          </span>
          {result.page < pages ? (
            <Link href={toPage(result.page + 1)} scroll={false} className="text-body text-accent underline underline-offset-2" data-testid="backup-history-next">
              {t("backups.history.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </Card>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="text-label font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function FilterLink({ href, active, testId, children }: { href: string; active: boolean; testId: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      data-testid={testId}
      className={cn("rounded-pill border px-2.5 py-0.5 text-label", active ? "border-strong bg-surface-hover font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover")}
    >
      {children}
    </Link>
  );
}

function HistoryRow({ run, t, who, when, repo }: { run: BackupRun; t: Translate; who: Who; when: When; repo: string }) {
  const url = runUrl(run, repo);
  const requester = {
    person: () => who(run.requested_by),
    system: () => t("backups.history.requestedBySystem"),
    github: () => t("backups.history.requestedByGithub"),
  }[requesterOf(run)]();
  return (
    <tr className="border-b last:border-b-0" data-testid="backup-run-row">
      <td className="px-3 py-2 text-fg-secondary">{when(runTime(run))}</td>
      <td className="px-3 py-2 text-fg">{t(kindKey(run.kind))}</td>
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
