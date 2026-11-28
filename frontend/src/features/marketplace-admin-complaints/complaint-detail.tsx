"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, InlineError, SectionTitle } from "@/components/ui/primitives";
import { Button, LabeledField, Textarea } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime, formatMoney } from "@/lib/ui/format";
import { decideComplaintAction, takeComplaintAction } from "@/server/actions/marketplace-complaints";
import { COMPLAINT_DECISIONS, noteIsValid, type ComplaintDecision, type ComplaintDetail } from "./model";

export type ReceiptPreview = { id: string; url: string | null; created_at: string; status: string };

/** One complaint: the order's money, the receipts (previews read under the admin's own session), the history, take and decide. */
export function ComplaintDetailView({ detail, receipts }: { detail: ComplaintDetail; receipts: ReceiptPreview[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [decision, setDecision] = useState<ComplaintDecision>("payment_valid");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const c = detail.complaint;
  const open = c.state === "open" || c.state === "under_review";
  const blockedByOther = c.state === "under_review" && c.taken && !c.taken_by_me;

  function run(action: () => Promise<{ ok: true } | { ok: false; code: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) { setError(result.code); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-lg" data-testid="complaint-detail">
      <Card className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <SectionTitle>{t("marketplaceComplaints.detail.order")} {detail.order.order_number}</SectionTitle>
          <Badge tone={open ? "warning" : "success"}>{t(`marketplaceComplaints.states.${c.state}`)}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-sm tablet:grid-cols-3 text-body">
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.seller")}</dt><dd>{detail.order.seller.name}</dd></div>
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.buyer")}</dt><dd>{detail.order.recipient.name}</dd></div>
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.reason")}</dt><dd>{t(`marketplaceComplaints.reasons.${c.reason}`)}</dd></div>
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.total")}</dt><dd>{formatMoney(detail.order.totals.total_egp, locale)}</dd></div>
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.paid")}</dt><dd>{formatMoney(detail.order.totals.paid_now_egp, locale)}</dd></div>
          <div><dt className="text-label text-fg-secondary">{t("marketplaceComplaints.columns.filedBy")}</dt><dd>{t(`marketplaceComplaints.filedBy.${c.filed_by_role}`)}</dd></div>
        </dl>
        {c.note ? <p className="text-body text-fg-secondary"><span className="font-medium">{t("marketplaceComplaints.detail.complaintNote")}: </span>{c.note}</p> : null}
      </Card>

      <Card className="flex flex-col gap-sm">
        <SectionTitle>{t("marketplaceComplaints.detail.receipts")}</SectionTitle>
        {receipts.length === 0 ? <p className="text-body text-fg-secondary">{t("marketplaceComplaints.detail.noReceipts")}</p> : (
          <ul className="grid grid-cols-1 gap-sm tablet:grid-cols-3">
            {receipts.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, ticketed receipt URL; not an optimizable public image
                  <img src={r.url} alt={t("marketplaceComplaints.detail.receiptAlt")} className="max-h-96 w-full rounded-md border object-contain" />
                ) : <div className="flex h-32 items-center justify-center rounded-md bg-surface-2 text-label text-fg-secondary">—</div>}
                <span className="text-label text-fg-secondary">{formatDateTime(r.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open ? (
        <Card className="flex flex-col gap-sm">
          {c.state === "open" ? (
            <Button size="sm" disabled={pending} onClick={() => run(() => takeComplaintAction(c.id))}>{t("marketplaceComplaints.detail.take")}</Button>
          ) : (
            <p className="text-body text-fg-secondary">{c.taken_by_me ? t("marketplaceComplaints.detail.takenByYou") : t("marketplaceComplaints.detail.takenByOther")}</p>
          )}
          {blockedByOther ? null : (
            <form className="flex flex-col gap-sm" onSubmit={(e) => { e.preventDefault(); run(() => decideComplaintAction(c.id, decision, note)); }}>
              <fieldset className="flex flex-col gap-1">
                <legend className="text-label font-medium text-fg-secondary">{t("marketplaceComplaints.detail.decision")}</legend>
                {COMPLAINT_DECISIONS.map((d) => (
                  <label key={d} className="flex items-start gap-sm text-body">
                    <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="mt-1" />
                    <span>
                      {t(`marketplaceComplaints.detail.decisions.${d}`)}
                      <span className="block text-label text-fg-secondary">{t(`marketplaceComplaints.detail.hints.${d}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <LabeledField label={t("marketplaceComplaints.detail.note")} htmlFor="complaint-note">
                <Textarea id="complaint-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </LabeledField>
              <div><Button type="submit" size="sm" disabled={pending || !noteIsValid(note)}>{t("marketplaceComplaints.detail.submit")}</Button></div>
            </form>
          )}
        </Card>
      ) : (
        <Card className="flex flex-col gap-1">
          <SectionTitle>{t("marketplaceComplaints.detail.decided")}</SectionTitle>
          {c.decision ? <p className="text-body">{t(`marketplaceComplaints.detail.decisions.${c.decision}`)}</p> : null}
          {c.decision_note ? <p className="text-body text-fg-secondary">{c.decision_note}</p> : null}
        </Card>
      )}
      {error ? <InlineError>{t(`marketplaceComplaints.errors.${error}`)}</InlineError> : null}

      <Card className="flex flex-col gap-sm">
        <SectionTitle>{t("marketplaceComplaints.detail.timeline")}</SectionTitle>
        <ol className="flex flex-col gap-1 text-body">
          {detail.events.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{t(`marketplaceComplaints.detail.actions.${e.action}`)}</span>
              <span className="text-fg-secondary"> · {formatDateTime(e.at, locale)}</span>
              {e.note ? <span className="block text-label text-fg-secondary">{e.note}</span> : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
