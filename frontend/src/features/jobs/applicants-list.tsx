"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { tradeLabel } from "@/lib/i18n/trade-label";
import {
  acceptApplicationAction,
  rejectApplicationAction,
} from "@/server/actions/job-forms";
import { Card, SectionTitle, Badge, StatePanel } from "@/components/ui/primitives";
import { Input, LabeledField } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Monogram } from "@/components/ui/data-table";
import { ApplicationStatusBadge } from "@/features/jobs/badges";
import { formatDate } from "@/lib/ui/format";
import type { JobApplicantRow } from "@/server/queries/jobs";

/**
 * The people who applied, and the one decision the poster makes about them.
 *
 * WHAT IS NOT HERE, deliberately: no fit percentage, no ranking, no recommended
 * badge, no score, no salary expectation, no contact details. None of those has
 * any backing in this repository — there is no matching model, and the projection
 * this reads carries no contact channel at all — so every one of them would be a
 * number the product invented and the poster would then trust.
 *
 * The order is the queue's own: live candidacies first, oldest at the top, then
 * the decided ones. Whoever has been waiting longest is the first thing read.
 */
export function ApplicantsList({
  jobId,
  applicants,
  canManage,
  jobIsOpen,
  locale,
}: {
  jobId: string;
  applicants: JobApplicantRow[];
  canManage: boolean;
  jobIsOpen: boolean;
  locale: Locale;
}) {
  const { t } = useI18n();

  if (applicants.length === 0) {
    return (
      <div data-testid="applicants-empty">
        <StatePanel
          title={t("jobs.applicants.emptyTitle")}
          body={t("jobs.applicants.emptyBody")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      {!canManage ? (
        <StatePanel
          tone="warning"
          title={t("jobs.applicants.deniedTitle")}
          body={t("jobs.applicants.deniedBody")}
        />
      ) : !jobIsOpen ? (
        <p className="text-label text-fg-muted">{t("jobs.applicants.decidedNote")}</p>
      ) : null}

      <ul className="flex flex-col gap-md" data-testid="applicants-list">
        {applicants.map((a) => (
          <li key={a.application_id}>
            <ApplicantCard
              jobId={jobId}
              applicant={a}
              /* A decision is offered only where one can actually be made: the
                 caller holds job.manage, the job is still open, and this
                 candidacy is still live. The RPCs refuse all three cases
                 independently — this only avoids offering the refusal. */
              canDecide={canManage && jobIsOpen && a.status === "submitted"}
              locale={locale}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplicantCard({
  jobId,
  applicant: a,
  canDecide,
  locale,
}: {
  jobId: string;
  applicant: JobApplicantRow;
  canDecide: boolean;
  locale: Locale;
}) {
  const { t } = useI18n();
  const name = a.display_name ?? "—";
  const trades = a.trade_keys ?? [];
  const secondary = trades.filter((k) => k !== a.primary_trade_key);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 items-start gap-md">
          <Monogram name={name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-lg font-medium text-fg">{name}</span>
              <ApplicationStatusBadge status={a.status ?? "submitted"} />
            </div>
            {a.headline ? (
              <p className="mt-0.5 text-body text-fg-secondary">{a.headline}</p>
            ) : null}

            {/* The canonical trades from Increment 5 — the structured category
                signal, primary first. Never a raw key: `tradeLabel` is the only
                thing that turns one into a word. */}
            {a.primary_trade_key ? (
              <div className="mt-sm flex flex-wrap items-center gap-2">
                <span className="text-label text-fg-muted">{t("jobs.applicants.mainTrade")}</span>
                <Badge tone="accent">{tradeLabel(t, a.primary_trade_key)}</Badge>
                {secondary.map((k) => (
                  <Badge key={k}>{tradeLabel(t, k)}</Badge>
                ))}
              </div>
            ) : null}

            <p className="mt-sm text-label text-fg-muted">
              {a.years_experience != null
                ? `${t("jobs.applicants.experience", { years: String(a.years_experience) })} · `
                : ""}
              {t("jobs.field.appliedOn")} {formatDate(a.applied_at, locale)}
            </p>
          </div>
        </div>

        {/* The public profile, linked ONLY when there is one to open. The
            projection returns a null id for a professional who has not published
            a profile, so this is the difference between a link and a 404. */}
        {a.public_profile_id ? (
          <Link
            href={`/p/${a.public_profile_id}`}
            className="shrink-0 text-label font-medium text-accent hover:underline"
          >
            {t("jobs.applicants.viewProfile")} →
          </Link>
        ) : null}
      </div>

      {a.note ? (
        <div className="mt-md border-t pt-md">
          <SectionTitle>{t("jobs.field.note")}</SectionTitle>
          <p className="mt-1 whitespace-pre-line text-body text-fg-secondary">{a.note}</p>
        </div>
      ) : null}

      {/* The poster's own words back to a candidate they turned down. Shown so
          the decision is legible later, to whoever opens this next. */}
      {a.status === "rejected" && a.decision_reason ? (
        <p className="mt-md border-t pt-md text-label text-fg-muted">{a.decision_reason}</p>
      ) : null}

      {canDecide ? (
        <div className="mt-md flex flex-wrap gap-sm border-t pt-md">
          <AcceptDialog jobId={jobId} applicationId={a.application_id!} name={name} />
          <RejectDialog jobId={jobId} applicationId={a.application_id!} name={name} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The award, behind a confirmation that names the consequence in full.
 *
 * It says what happens to EVERYONE ELSE, because that is the part a poster will
 * not have thought about: accepting one application auto-rejects every sibling
 * still in the running, inside the same database transaction. The dialog is not
 * running that rule — `job_application_accept` is — it is disclosing it.
 */
function AcceptDialog({
  jobId,
  applicationId,
  name,
}: {
  jobId: string;
  applicationId: string;
  name: string;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("jobs.accept.action")}
      triggerVariant="accent"
      confirmVariant="accent"
      title={t("jobs.accept.title", { name })}
      body={t("jobs.accept.body")}
      confirmLabel={t("jobs.accept.confirm")}
      formAction={acceptApplicationAction}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="jobId" value={jobId} />
    </ConfirmDialog>
  );
}

function RejectDialog({
  jobId,
  applicationId,
  name,
}: {
  jobId: string;
  applicationId: string;
  name: string;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("jobs.reject.action")}
      triggerVariant="outline"
      title={t("jobs.reject.title", { name })}
      body={t("jobs.reject.body")}
      confirmLabel={t("jobs.reject.confirm")}
      formAction={rejectApplicationAction}
    >
      {(state) => (
        <>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="jobId" value={jobId} />
          <div className="mt-sm">
            {/* Required by `ck_job_app_reject_reason`, and asked for HERE so the
                person writing it sees the requirement before they lose what they
                typed. The applicant reads this text, which the hint says. */}
            <LabeledField
              label={t("jobs.reject.reason")}
              htmlFor={`reason-${applicationId}`}
              hint={t("jobs.reject.reasonHint")}
              error={
                state.fieldErrors?.reason ? t(state.fieldErrors.reason) : undefined
              }
            >
              <Input id={`reason-${applicationId}`} name="reason" maxLength={500} />
            </LabeledField>
          </div>
        </>
      )}
    </ConfirmDialog>
  );
}
