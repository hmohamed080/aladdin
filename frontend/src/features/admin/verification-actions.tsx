"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, SubmitButton, Textarea } from "@/components/ui/controls";
import {
  startReviewAction,
  approveVerificationAction,
  rejectVerificationAction,
  type ReviewFormState,
} from "@/server/actions/admin-forms";
import type { VerificationRow } from "@/server/queries/admin";

const INITIAL: ReviewFormState = { ok: false };

/**
 * Decision controls for a pending verification. Approve/Reject auto-claim the
 * review first (the RPC enforces the real state machine + no-self-review). A
 * rejection requires a reason, matching the RPC guard.
 */
export function VerificationActions({ v }: { v: VerificationRow }) {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [startState, start] = useActionState(startReviewAction, INITIAL);
  const [approveState, approve] = useActionState(approveVerificationAction, INITIAL);
  const [rejectState, reject] = useActionState(rejectVerificationAction, INITIAL);

  const decided = v.status === "approved" || v.status === "rejected";
  const message =
    (startState.code && (startState.ok ? null : startState.code)) ||
    (approveState.code ?? null) ||
    (rejectState.code ?? null);
  const messageOk = approveState.ok || rejectState.ok || startState.ok;

  if (decided) {
    return v.reason ? <p className="text-label text-fg-muted">{v.reason}</p> : null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {v.status === "submitted" ? (
          <form action={start}>
            <input type="hidden" name="id" value={v.id} />
            <SubmitButton size="sm" variant="outline">
              {t("admin.review.start")}
            </SubmitButton>
          </form>
        ) : null}

        <form action={approve}>
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="status" value={v.status} />
          <input type="hidden" name="grantListing" value="true" />
          <SubmitButton size="sm">{t("admin.review.approve")}</SubmitButton>
        </form>

        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRejecting((x) => !x)}>
          {t("admin.review.reject")}
        </Button>
      </div>

      {rejecting ? (
        <form action={reject} className="flex flex-col gap-2 rounded-md border border-dashed p-md">
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="status" value={v.status} />
          <Textarea name="reason" required rows={2} placeholder={t("admin.review.reasonPlaceholder")} />
          <div>
            <SubmitButton size="sm" variant="outline" className="text-danger">
              {t("admin.review.confirmReject")}
            </SubmitButton>
          </div>
        </form>
      ) : null}

      {message ? (
        <span className={`text-label ${messageOk ? "text-success" : "text-danger"}`}>{t(message)}</span>
      ) : null}
    </div>
  );
}
