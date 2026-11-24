"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Button, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { fileComplaintAction } from "@/server/actions/marketplace-complaints";
import { COMPLAINT_REASONS, type ComplaintReason } from "./model";

/**
 * «الإبلاغ عن مشكلة في الدفع»: the slot PR 13's order pages render for the `file_complaint` action (buyer and showroom order
 * managers, only while the receipt is disputed). The order document's `actions` decides whether to show it; the database re-checks.
 */
export function FileComplaint({ orderId }: { orderId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ComplaintReason>("transfer_made");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <InlineSuccess>{t("marketplaceComplaints.file.done")}</InlineSuccess>;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t("marketplaceComplaints.file.open")}</Button>;

  return (
    <Card className="flex flex-col gap-sm" data-testid="file-complaint">
      <h2 className="text-label font-medium text-fg">{t("marketplaceComplaints.file.title")}</h2>
      <LabeledField label={t("marketplaceComplaints.file.reason")} htmlFor="complaint-reason">
        <Select id="complaint-reason" value={reason} onChange={(e) => setReason(e.target.value as ComplaintReason)}>
          {COMPLAINT_REASONS.map((r) => <option key={r} value={r}>{t(`marketplaceComplaints.reasons.${r}`)}</option>)}
        </Select>
      </LabeledField>
      <LabeledField label={t("marketplaceComplaints.file.note")} htmlFor="complaint-details">
        <Textarea id="complaint-details" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </LabeledField>
      {error ? <InlineError>{t(`marketplaceComplaints.errors.${error}`)}</InlineError> : null}
      <div className="flex gap-sm">
        <Button size="sm" disabled={pending} onClick={() => {
          setError(null);
          start(async () => {
            const result = await fileComplaintAction(orderId, reason, note);
            if (!result.ok) { setError(result.code); return; }
            setDone(true);
            router.refresh();
          });
        }}>{t("marketplaceComplaints.file.submit")}</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{t("marketplaceComplaints.file.cancel")}</Button>
      </div>
    </Card>
  );
}
