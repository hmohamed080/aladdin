"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Textarea } from "@/components/ui/controls";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import { ReasonPanel } from "@/features/marketplace-orders/reason-panel";
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
import { REFUND_METHOD_LABEL, RETURN_ACTION_LABEL, RETURN_COPY, returnErrorText } from "./copy";
import { isValidReturnTracking, type ReturnAction, type ReturnDocument } from "./contract";

type Role = "buyer" | "seller" | "admin";
type Res = { ok: boolean; code?: string };

/** Actions that first open their own small form; every other button acts at once. */
type FormAction = "reject" | "propose_partial" | "file_complaint";
const HAS_FORM: readonly ReturnAction[] = ["reject", "propose_partial", "file_complaint"];

/** Renders exactly the actions the database listed in doc.actions; each button calls the RPC wrapper and refreshes. */
export function ReturnActions({ doc, role, locale }: { doc: ReturnDocument; role: Role; locale: "ar" | "en" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<FormAction | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [tracking, setTracking] = useState("");
  const [complaint, setComplaint] = useState("");
  const [amount, setAmount] = useState("");
  const [partialNote, setPartialNote] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  // an admin decision is final: it is sent only after a second, explicit press
  const [adminAsk, setAdminAsk] = useState<"approve" | "reject" | null>(null);
  // nothing goes back into sellable stock unless the showroom says it is in good condition
  const [good, setGood] = useState<Record<string, boolean>>({});
  const t = (k: keyof typeof RETURN_COPY) => RETURN_COPY[k][locale];
  const value = doc.items.reduce((sum, i) => sum + Number(i.line_total_egp), 0);
  const has = (a: ReturnAction) => doc.actions.includes(a);
  // an admin decides with one internal note; the others write only inside the form of the action they chose
  const adminDecides = role === "admin" && (has("approve") || has("reject"));

  const run = (fn: () => Promise<Res>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : returnErrorText(locale, r.code ?? "unexpected"));
      if (r.ok) {
        setOpen(null);
        setAdminAsk(null);
        router.refresh();
      }
    });

  const refuse = (k: keyof typeof RETURN_COPY) => setError(t(k));

  const press = (a: ReturnAction) => {
    setError(null);
    if (adminDecides && (a === "approve" || a === "reject")) {
      if (adminNote.trim().length < 3) return refuse("adminNoteRequired");
      return setAdminAsk(a);
    }
    if (HAS_FORM.includes(a)) return setOpen(a as FormAction);
    if (a === "mark_shipped") {
      if (!isValidReturnTracking(tracking)) return refuse("trackingInvalid");
      return run(() => markReturnShippedAction(doc.id, tracking));
    }
    const handlers: Partial<Record<ReturnAction, () => Promise<Res>>> = {
      cancel: () => cancelReturnAction(doc.id),
      confirm_refund: () => confirmRefundAction(doc.id),
      approve: () => decideReturnAction(doc.id, { decision: "approve" }),
      receive: () => receiveReturnAction(doc.id, doc.items.map((i) => ({ item_id: i.item_id, sellable: good[i.item_id] === true }))),
      // the amount is exactly what was agreed: the database refuses any other figure
      record_refund: () => recordRefundAction(doc.id, Number(doc.max_refund_egp), reference),
      fulfil_exchange: () => fulfilExchangeAction(doc.id, reference),
      remind_seller: () => adminRemindSellerAction(doc.id),
    };
    const fn = handlers[a];
    if (fn) run(fn);
  };

  const sendPartial = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || n >= value) return setError(RETURN_COPY.partialInvalid[locale].replace("{max}", fmtEgp(value, locale)));
    const note = partialNote.trim();
    if (note && note.length < 3) return refuse("noteTooShort");
    setError(null);
    run(() => decideReturnAction(doc.id, { decision: "propose_partial", messageAr: note, messageEn: note, partialRefundEgp: n }));
  };

  const sendComplaint = () => {
    if (complaint.trim().length < 3) return refuse("complaintRequired");
    setError(null);
    run(() => fileReturnComplaintAction(doc.id, complaint));
  };

  if (doc.actions.length === 0) return null;

  const field = (label: string, control: ReactNode, hint?: string) => (
    <label className="grid gap-1 text-label">
      {label}
      {control}
      {hint ? <span className="text-caption text-fg-muted">{hint}</span> : null}
    </label>
  );

  return (
    <section className="flex flex-col gap-sm rounded-md border bg-surface p-md" aria-label="actions">
      {adminDecides
        ? field(`${t("noteInternal")} (${t("required")})`, <Textarea maxLength={500} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />)
        : null}
      {role === "admin" && doc.partial_refund_egp !== null && has("approve") ? <p className="text-label text-fg-secondary">{t("partialAppeal")}</p> : null}
      {has("mark_shipped")
        ? field(t("tracking"), <Input dir="ltr" maxLength={64} value={tracking} onChange={(e) => setTracking(e.target.value)} />, t("trackingHint"))
        : null}
      {has("receive") ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-fg-secondary">{t("sellableHint")}</legend>
          {doc.items.map((i) => (
            <Checkbox key={i.item_id} id={`sellable-${i.item_id}`} name="sellable" checked={good[i.item_id] === true} onChange={(v) => setGood((g) => ({ ...g, [i.item_id]: v }))}>
              {(locale === "ar" ? i.name_ar : i.name_en) + " × " + i.quantity + " — " + t("sellable")}
            </Checkbox>
          ))}
        </fieldset>
      ) : null}
      {has("record_refund") ? (
        <div className="grid gap-sm">
          <p className="text-body font-semibold">
            {t("refundToPay")}: <span className="tabular-nums">{fmtEgp(Number(doc.max_refund_egp), locale)}</span> · {REFUND_METHOD_LABEL[doc.payment_method]?.[locale] ?? doc.payment_method}
          </p>
          {field(t("referenceNote"), <Input maxLength={300} value={reference} onChange={(e) => setReference(e.target.value)} />)}
        </div>
      ) : null}
      {has("fulfil_exchange") ? field(t("exchangeNote"), <Input maxLength={300} value={reference} onChange={(e) => setReference(e.target.value)} />) : null}

      <div className="flex flex-wrap gap-sm">
        {doc.actions.map((a) => (
          <Button key={a} variant="outline" size="sm" disabled={pending} aria-expanded={!adminDecides && HAS_FORM.includes(a) ? open === a : undefined} onClick={() => press(a)}>
            {RETURN_ACTION_LABEL[a][locale]}
          </Button>
        ))}
      </div>

      {adminDecides && adminAsk ? (
        <div className="grid gap-sm rounded-sm border p-md" role="group" aria-label={t(adminAsk === "approve" ? "adminApproveAsk" : "adminRejectAsk")}>
          <p className="text-body">{t(adminAsk === "approve" ? "adminApproveAsk" : "adminRejectAsk")}</p>
          <div className="flex flex-wrap gap-sm">
            <Button size="sm" disabled={pending} onClick={() => run(() => adminDecideReturnAction(doc.id, adminAsk, adminNote, "", ""))}>
              {t(adminAsk === "approve" ? "adminApproveConfirm" : "rejectConfirm")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setAdminAsk(null)}>{t("back")}</Button>
          </div>
        </div>
      ) : null}
      {open === "reject" && !adminDecides ? (
        <ReasonPanel
          action="return_reject"
          title={t("rejectTitle")}
          intro={t("rejectIntro")}
          confirmLabel={t("rejectConfirm")}
          keepLabel={t("back")}
          danger
          busy={pending}
          onCancel={() => setOpen(null)}
          onSubmit={(reason) =>
            run(() =>
              decideReturnAction(
                doc.id,
                "preset_id" in reason ? { decision: "reject", presetId: reason.preset_id } : { decision: "reject", messageAr: reason.message_ar, messageEn: reason.message_en },
              ),
            )
          }
        />
      ) : null}
      {open === "propose_partial" ? (
        <div className="grid gap-sm rounded-sm border p-md">
          {field(t("partialAmount"), <Input inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />, RETURN_COPY.partialHint[locale].replace("{max}", fmtEgp(value, locale)))}
          {field(t("partialNote"), <Textarea maxLength={300} value={partialNote} onChange={(e) => setPartialNote(e.target.value)} />)}
          <div className="flex flex-wrap gap-sm">
            <Button size="sm" disabled={pending} onClick={sendPartial}>{t("partialSend")}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(null)}>{t("back")}</Button>
          </div>
        </div>
      ) : null}
      {open === "file_complaint" ? (
        <div className="grid gap-sm rounded-sm border p-md">
          {field(`${t("complaintReason")} (${t("required")})`, <Textarea maxLength={500} value={complaint} onChange={(e) => setComplaint(e.target.value)} />, t("complaintHint"))}
          <div className="flex flex-wrap gap-sm">
            <Button size="sm" disabled={pending} onClick={sendComplaint}>{t("complaintSend")}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(null)}>{t("back")}</Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
