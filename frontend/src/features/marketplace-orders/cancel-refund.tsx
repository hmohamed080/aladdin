"use client";

import { useState, useTransition } from "react";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/context";
import { buyerConfirmCancelRefundAction, sellerRecordCancelRefundAction } from "@/server/actions/marketplace-order-pages";
import { money } from "./order-parts";
import { orderError } from "./orders-copy";
import type { OrderDocumentV2 } from "./order-types";

const COPY = {
  en: {
    record: "I paid the money back",
    recordIntro: "Pay the amount to the buyer outside the platform, then record it here. The buyer confirms receiving it.",
    note: "Transfer reference (optional, shown to the buyer)",
    recordYes: "Record the refund",
    confirm: "I received my money back",
    confirmIntro: "Confirm only after the amount has reached you. This closes the refund.",
    confirmYes: "Yes, I received it",
    keep: "Not now",
  },
  ar: {
    record: "رددت المبلغ",
    recordIntro: "حوّل المبلغ للمشتري خارج المنصة ثم سجّله هنا. يؤكّد المشتري استلامه.",
    note: "مرجع التحويل (اختياري، يظهر للمشتري)",
    recordYes: "تسجيل رد المبلغ",
    confirm: "استلمت المبلغ",
    confirmIntro: "أكّد فقط بعد وصول المبلغ إليك. هذا يُغلق الاسترداد.",
    confirmYes: "نعم، استلمته",
    keep: "ليس الآن",
  },
} as const;

/** The two sides of a cancelled order's refund (actions `record_cancel_refund` / `confirm_cancel_refund`). The platform moves no money. */
export function CancelRefund({ order, mode, onDone }: { order: OrderDocumentV2; mode: "record" | "confirm"; onDone: (next: OrderDocumentV2) => void }) {
  const { locale } = useI18n();
  const c = COPY[locale];
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <Button variant="accent" onClick={() => setOpen(true)}>{mode === "record" ? c.record : c.confirm}</Button>;

  const submit = () =>
    start(async () => {
      setError(null);
      const r = mode === "record" ? await sellerRecordCancelRefundAction(order.id, note) : await buyerConfirmCancelRefundAction(order.id);
      if (!r.ok) {
        setError(orderError(locale, r.code));
        return;
      }
      setOpen(false);
      onDone(r.order);
    });

  return (
    <section className="grid gap-sm rounded-sm border p-md" aria-label={mode === "record" ? c.record : c.confirm}>
      <p className="text-body">
        {mode === "record" ? c.recordIntro : c.confirmIntro} <strong>{money(order.totals.paid_now_egp ?? order.totals.total_egp, locale)}</strong>
      </p>
      {mode === "record" ? (
        <LabeledField label={c.note} htmlFor="cancel-refund-note">
          <Input id="cancel-refund-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </LabeledField>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex flex-wrap gap-sm">
        <Button disabled={pending} onClick={submit}>{mode === "record" ? c.recordYes : c.confirmYes}</Button>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{c.keep}</Button>
      </div>
    </section>
  );
}
