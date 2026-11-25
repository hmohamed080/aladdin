"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Textarea } from "@/components/ui/controls";
import {
  adminDecideReturnAction,
  adminRemindSellerAction,
  cancelReturnAction,
  confirmRefundAction,
  decideReturnAction,
  fileReturnComplaintAction,
  fulfilExchangeAction,
  markReturnShippedAction,
  receiveReturnAction,
  recordRefundAction,
} from "@/server/actions/marketplace-returns";
import { RETURN_ACTION_LABEL, RETURN_COPY } from "./copy";
import type { ReturnAction, ReturnDocument } from "./contract";

type Role = "buyer" | "seller" | "admin";
type Res = { ok: boolean };

const NEEDS_TEXT: ReturnAction[] = ["approve", "reject", "propose_partial", "file_complaint", "mark_shipped", "record_refund", "fulfil_exchange"];

/** Renders exactly the actions the database listed in doc.actions; each button calls the RPC wrapper and refreshes. */
export function ReturnActions({ doc, role, locale }: { doc: ReturnDocument; role: Role; locale: "ar" | "en" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [failed, setFailed] = useState(false);
  // nothing goes back into sellable stock unless the showroom says it is in good condition
  const [good, setGood] = useState<Record<string, boolean>>({});

  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      const r = await fn();
      setFailed(!r.ok);
      if (r.ok) {
        setText("");
        router.refresh();
      }
    });

  const msg = { messageAr: text, messageEn: text };
  const handlers: Record<ReturnAction, () => Promise<Res>> = {
    cancel: () => cancelReturnAction(doc.id),
    mark_shipped: () => markReturnShippedAction(doc.id, text),
    confirm_refund: () => confirmRefundAction(doc.id),
    file_complaint: () => fileReturnComplaintAction(doc.id, text),
    approve: () => (role === "admin" ? adminDecideReturnAction(doc.id, "approve", text, "", "") : decideReturnAction(doc.id, { decision: "approve", ...msg })),
    reject: () => (role === "admin" ? adminDecideReturnAction(doc.id, "reject", text, "", "") : decideReturnAction(doc.id, { decision: "reject", ...msg })),
    propose_partial: () => decideReturnAction(doc.id, { decision: "propose_partial", ...msg, partialRefundEgp: Number(amount) }),
    receive: () => receiveReturnAction(doc.id, doc.items.map((i) => ({ item_id: i.item_id, sellable: good[i.item_id] === true }))),
    record_refund: () => recordRefundAction(doc.id, Number(amount), text),
    fulfil_exchange: () => fulfilExchangeAction(doc.id, text),
    remind_seller: () => adminRemindSellerAction(doc.id),
  };

  if (doc.actions.length === 0) return null;
  const needsText = doc.actions.some((a) => NEEDS_TEXT.includes(a));
  const needsAmount = doc.actions.some((a) => a === "propose_partial" || a === "record_refund");

  return (
    <section className="flex flex-col gap-sm rounded-md border bg-surface p-md" aria-label="actions">
      {needsText ? (
        <label className="flex flex-col gap-1 text-label">
          {(role === "admin" ? RETURN_COPY.noteInternal : RETURN_COPY.note)[locale]}
          <Textarea maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      ) : null}
      {needsAmount ? (
        <label className="flex flex-col gap-1 text-label">
          {RETURN_COPY.amount[locale]}
          <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      ) : null}
      {doc.actions.includes("receive") ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-fg-secondary">{RETURN_COPY.sellableHint[locale]}</legend>
          {doc.items.map((i) => (
            <Checkbox key={i.item_id} id={`sellable-${i.item_id}`} name="sellable" checked={good[i.item_id] === true} onChange={(v) => setGood((g) => ({ ...g, [i.item_id]: v }))}>
              {(locale === "ar" ? i.name_ar : i.name_en) + " × " + i.quantity + " — " + RETURN_COPY.sellable[locale]}
            </Checkbox>
          ))}
        </fieldset>
      ) : null}
      {role === "admin" && doc.partial_refund_egp !== null && doc.actions.includes("approve") ? (
        <p className="text-label text-fg-secondary">{RETURN_COPY.partialAppeal[locale]}</p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        {doc.actions.map((a) => (
          <Button key={a} variant="outline" size="sm" disabled={pending} onClick={() => run(handlers[a])}>
            {RETURN_ACTION_LABEL[a][locale]}
          </Button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-label text-danger">
          {RETURN_COPY.failed[locale]}
        </p>
      ) : null}
    </section>
  );
}
