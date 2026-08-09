"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import {
  activateProjectAction,
  completeProjectAction,
  type FormState,
} from "@/server/actions/execution-forms";
import { Card, SectionTitle, Field, InlineError } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/controls";
import { ActivityIcon, ClockIcon, CheckIcon, PackageIcon } from "@/components/ui/icons";
import { ProjectStatusBadge, ProjectCompletedBadge } from "@/features/execution/badges";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import type { ProjectRow } from "@/server/queries/execution";

const initial: FormState = { ok: false };

type Role = { isExecutor: boolean; isRequester: boolean; canProject: boolean };

export function ProjectDetail({
  project,
  requesterName,
  executingName,
  role,
  locale,
}: {
  project: ProjectRow;
  requesterName: string;
  executingName: string;
  role: Role;
  locale: Locale;
}) {
  const { t } = useI18n();
  const isCompleted = project.status === "completed";
  const canActivate = role.isExecutor && role.canProject && project.status === "planned";
  const canComplete = role.isExecutor && role.canProject && project.status === "active";

  return (
    <div className="flex flex-col gap-lg">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{project.title}</h1>
              {isCompleted ? <ProjectCompletedBadge /> : <ProjectStatusBadge status={project.status} />}
            </div>
            <Link
              href={`/b2b/orders/${project.order_id}`}
              className="inline-flex items-center gap-1.5 text-label text-fg-secondary hover:text-fg"
            >
              <PackageIcon size={14} />
              {t("execution.project.viewOrder")}
            </Link>
          </div>
        </div>
        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("execution.project.requester")}>{requesterName}</Field>
          <Field label={t("execution.project.executor")}>{executingName}</Field>
          <Field label={t("execution.project.startDate")}>{formatDate(project.start_date, locale)}</Field>
          <Field label={t("execution.project.targetDate")}>{formatDate(project.target_date, locale)}</Field>
        </dl>
      </Card>

      {/* PROJECT COMPLETED banner */}
      {isCompleted ? (
        <div
          role="status"
          className="rounded-md border border-success/40 bg-success/10 px-lg py-md text-center"
        >
          <p className="text-title font-semibold text-success">{t("execution.projectCompleted")}</p>
          <p className="mt-1 text-body text-fg-secondary">{t("execution.project.completedBody")}</p>
        </div>
      ) : null}

      {/* Execution overview */}
      <Card>
        <SectionTitle icon={<ActivityIcon size={18} />}>{t("execution.project.overview")}</SectionTitle>
        <dl className="mt-md grid gap-md tablet:grid-cols-2">
          <Field label={t("execution.project.location")}>{project.location ?? "—"}</Field>
          <Field label={t("execution.project.status")}>
            <ProjectStatusBadge status={project.status} />
          </Field>
        </dl>
        {project.description ? (
          <div className="mt-md border-t pt-md">
            <p className="text-label text-fg-muted">{t("execution.project.description")}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-body text-fg">{project.description}</p>
          </div>
        ) : null}
      </Card>

      {/* Activity trail (derived from the audited lifecycle timestamps) */}
      <Card>
        <SectionTitle icon={<ClockIcon size={18} />}>{t("execution.project.activity")}</SectionTitle>
        <ol className="mt-md flex flex-col gap-2.5">
          <Step done label={t("execution.project.tlPlanned")} at={project.created_at} locale={locale} />
          <Step done={!!project.activated_at} label={t("execution.project.tlActive")} at={project.activated_at} locale={locale} />
          <Step done={!!project.completed_at} label={t("execution.project.tlCompleted")} at={project.completed_at} locale={locale} />
        </ol>
      </Card>

      {/* Next action */}
      {canActivate || canComplete ? (
        <Card>
          <SectionTitle>{t("execution.project.nextAction")}</SectionTitle>
          <p className="mt-1 text-label text-fg-muted">
            {canActivate ? t("execution.project.activateHint") : t("execution.project.completeHint")}
          </p>
          <div className="mt-md">
            {canActivate ? (
              <LifecycleForm
                action={activateProjectAction}
                projectId={project.id}
                version={project.version}
                label={t("execution.project.activate")}
              />
            ) : (
              <LifecycleForm
                action={completeProjectAction}
                projectId={project.id}
                version={project.version}
                label={t("execution.project.complete")}
              />
            )}
          </div>
        </Card>
      ) : isCompleted ? null : (
        <Card>
          <p className="text-body text-fg-secondary">{t("execution.project.awaitingExecutor")}</p>
        </Card>
      )}
    </div>
  );
}

function Step({
  done,
  label,
  at,
  locale,
}: {
  done: boolean;
  label: string;
  at: string | null;
  locale: Locale;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={
          done
            ? "flex size-6 items-center justify-center rounded-pill bg-success/15 text-success"
            : "flex size-6 items-center justify-center rounded-pill bg-surface-2 text-fg-muted"
        }
      >
        <CheckIcon size={14} />
      </span>
      <span className={done ? "text-body text-fg" : "text-body text-fg-muted"}>{label}</span>
      {at ? <span className="ms-auto text-label text-fg-muted">{formatDateTime(at, locale)}</span> : null}
    </li>
  );
}

function LifecycleForm({
  action,
  projectId,
  version,
  label,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  projectId: string;
  version: number;
  label: string;
}) {
  const { t } = useI18n();
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {label}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}
