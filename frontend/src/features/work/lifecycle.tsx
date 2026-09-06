"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  startWorkAction,
  addProgressAction,
  cancelAssignmentAction,
  completeAssignmentAction,
} from "@/server/actions/assignment-forms";
import type { FormState } from "@/server/actions/job-forms";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, LabeledField, SubmitButton, Textarea } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { formatPercent } from "@/lib/ui/format";

/**
 * Every control that can MOVE an assignment, in one file — and the file is
 * organised by ACTOR, because that is the boundary this increment is most able
 * to lose.
 *
 * Installer:   StartWork · ReportProgress · CancelAssignment
 * Poster:      ConfirmCompletion · EndAssignment
 *
 * THERE IS NO INSTALLER COMPLETION CONTROL, and there is nothing here it could
 * be built from: `assignment-forms.ts` exposes no such action and the database
 * exposes no such RPC to an installer. §16 asks for a test proving the frontend
 * cannot accidentally expose one; the reason such a test can pass is that the
 * capability is absent rather than merely unrendered.
 *
 * Cancellation appears TWICE, deliberately. `job_assignment_cancel` admits
 * either party, so both get the action — but the wording differs because the
 * consequence differs: the installer is walking away from work they took, and
 * the organization is ending an engagement and getting its opening back. One
 * shared dialog with a neutral sentence would have been the smaller diff and the
 * worse product.
 *
 * Each dialog carries `expectedVersion` as a hidden field taken from the row the
 * reader is looking at. That is what makes the optimistic-concurrency check
 * real: a version re-read at submit time would always match itself.
 */

const initial: FormState = { ok: false };

/* ---- Installer --------------------------------------------------------- */

/**
 * `scheduled` -> `in_progress`.
 *
 * A confirmation rather than a bare button: starting is visible to the
 * organization immediately and cannot be undone except by cancelling the whole
 * assignment, which is a much larger act.
 */
export function StartWorkDialog({
  assignmentId,
  version,
}: {
  assignmentId: string;
  version: number;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("work.start.action")}
      triggerVariant="accent"
      confirmVariant="accent"
      title={t("work.start.title")}
      body={t("work.start.body")}
      confirmLabel={t("work.start.confirm")}
      formAction={startWorkAction}
    >
      {(state) => (
        <>
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="expectedVersion" value={version} />
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </>
      )}
    </ConfirmDialog>
  );
}

/**
 * One progress report.
 *
 * §13: the reader must never have to type a raw database integer to say
 * something as simple as "about half". So the control is a RANGE with a live
 * figure beside it and a number input bound to the same value — the slider is
 * the fast, coarse gesture and the number is the exact one, and they are one
 * field. Both are `min=0 max=100 step=5`... with the number input free to hold
 * any integer, because the database accepts any integer and a client that
 * refused 63 would be inventing a rule.
 *
 * The current value seeds the control, so reporting progress starts from where
 * the work actually is rather than from zero.
 */
export function ReportProgressDialog({
  assignmentId,
  jobId,
  current,
}: {
  assignmentId: string;
  jobId: string;
  current: number;
}) {
  const { t, locale } = useI18n();
  const [percent, setPercent] = useState(current);

  return (
    <ConfirmDialog
      trigger={t("work.progress.action")}
      triggerVariant="accent"
      confirmVariant="accent"
      title={t("work.progress.dialogTitle")}
      body={t("work.progress.dialogBody")}
      confirmLabel={t("work.progress.confirm")}
      formAction={addProgressAction}
    >
      {(state) => (
        <div className="mt-sm flex flex-col gap-md">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="jobId" value={jobId} />

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-sm">
              <label htmlFor={`percent-${assignmentId}`} className="text-label text-fg-secondary">
                {t("work.progress.percent")}
              </label>
              <span className="text-title font-semibold tabular-nums text-fg">
                {formatPercent(percent, locale)}
              </span>
            </div>
            {/* The coarse gesture. It carries no `name`: the number input below
                is the single submitted field, so there is exactly one value in
                the FormData and no chance of the two disagreeing. */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              aria-label={t("work.progress.percent")}
              className="w-full accent-accent-solid"
            />
            <div className="flex items-center gap-sm">
              <Input
                id={`percent-${assignmentId}`}
                name="percent"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-label text-fg-muted">{t("work.progress.percentHint")}</span>
            </div>
            {state.fieldErrors?.percent ? (
              <InlineError>{t(state.fieldErrors.percent)}</InlineError>
            ) : null}
          </div>

          <LabeledField
            label={t("work.progress.stage")}
            htmlFor={`stage-${assignmentId}`}
            hint={t("work.progress.stageHint")}
          >
            <Input id={`stage-${assignmentId}`} name="stage" maxLength={80} />
          </LabeledField>

          <LabeledField
            label={t("work.progress.note")}
            htmlFor={`note-${assignmentId}`}
            hint={t("work.progress.noteHint")}
          >
            <Textarea id={`note-${assignmentId}`} name="note" rows={3} maxLength={1000} />
          </LabeledField>

          <p className="text-label text-fg-muted">{t("work.progress.appendOnly")}</p>
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}

/** The installer's half of `job_assignment_cancel`. */
export function CancelAssignmentDialog({
  assignmentId,
  jobId,
  version,
}: {
  assignmentId: string;
  jobId: string;
  version: number;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("work.cancel.action")}
      title={t("work.cancel.title")}
      body={t("work.cancel.body")}
      confirmLabel={t("work.cancel.confirm")}
      formAction={cancelAssignmentAction}
    >
      {(state) => (
        <div className="mt-sm flex flex-col gap-sm">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <LabeledField
            label={t("work.cancel.reason")}
            htmlFor={`cancel-reason-${assignmentId}`}
            hint={t("work.cancel.reasonHint")}
          >
            <Input id={`cancel-reason-${assignmentId}`} name="reason" maxLength={500} required />
          </LabeledField>
          {state.fieldErrors?.reason ? (
            <InlineError>{t(state.fieldErrors.reason)}</InlineError>
          ) : null}
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}

/* ---- Posting organization ----------------------------------------------- */

/**
 * THE authority line of this domain, as a control.
 *
 * It is a plain form rather than a dialog because it sits inside the poster's
 * awarded panel beside the progress it is confirming — the context IS the
 * confirmation, and a modal would hide the figure the decision rests on. The
 * action is still irreversible, which is what the body copy beside it says.
 */
export function ConfirmCompletionForm({
  assignmentId,
  jobId,
  version,
}: {
  assignmentId: string;
  jobId: string;
  version: number;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(completeAssignmentAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("work.complete.action")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

/**
 * The organization's half of `job_assignment_cancel` — the same RPC the
 * installer calls, with the consequence stated from this side: the opening comes
 * back, and previously declined applications stay declined.
 */
export function EndAssignmentDialog({
  assignmentId,
  jobId,
  version,
}: {
  assignmentId: string;
  jobId: string;
  version: number;
}) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      trigger={t("work.poster.cancelAction")}
      title={t("work.poster.cancelTitle")}
      body={t("work.poster.cancelBody")}
      confirmLabel={t("work.poster.cancelConfirm")}
      formAction={cancelAssignmentAction}
    >
      {(state) => (
        <div className="mt-sm flex flex-col gap-sm">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <LabeledField
            label={t("work.poster.cancelReason")}
            htmlFor={`end-reason-${assignmentId}`}
            hint={t("work.poster.cancelReasonHint")}
          >
            <Input id={`end-reason-${assignmentId}`} name="reason" maxLength={500} required />
          </LabeledField>
          {state.fieldErrors?.reason ? (
            <InlineError>{t(state.fieldErrors.reason)}</InlineError>
          ) : null}
          {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
        </div>
      )}
    </ConfirmDialog>
  );
}
