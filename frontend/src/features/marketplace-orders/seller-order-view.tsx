"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Textarea } from "@/components/ui/controls";
import { EyeIcon, ReceiptIcon, StorefrontIcon, TruckIcon, UserIcon } from "@/components/ui/icons";
import { formatEgp } from "@/lib/ui/egp-format";
import { proofImageUrlAction, reviewProofAction, sellerOrderTransitionAction } from "@/server/actions/marketplace-orders";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import {
  actionNeedsReason,
  depositSettled,
  orderErrorCode,
  sellerActionsFor,
  type OrderDocument,
  type SellerAction,
} from "./contract";

type Message = { ok: boolean; text: string };
const card = "rounded-md border bg-surface p-md shadow-card";

/**
 * One order as the showroom works it: items, buyer, receiving, payment (with InstaPay receipt review)
 * and the next steps. Every button maps to marketplace_seller_order_transition / _proof_review, which
 * re-check the member's authority and the order's state and move stock in the same transaction.
 */
export function SellerOrderView({ initial }: { initial: OrderDocument }) {
  const { t, locale } = useI18n();
  const k = (key: string) => t(`marketplaceSeller.orders.${key}`);
  const [order, setOrder] = useState(initial);
  const [pending, setPending] = useState<SellerAction | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, start] = useTransition();
  const money = (n: number | null) => (n === null ? "—" : formatEgp(Number(n), locale));
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const fail = (code: string) => setMessage({ ok: false, text: t(`marketplaceSeller.orderError.${orderErrorCode(code)}`) });

  const run = (action: SellerAction) => {
    setMessage(null);
    if (actionNeedsReason(action) && pending !== action) {
      setPending(action);
      return;
    }
    if (actionNeedsReason(action) && note.trim() === "") {
      setMessage({ ok: false, text: k("reasonRequired") });
      return;
    }
    start(async () => {
      const r = await sellerOrderTransitionAction(order.id, action, note);
      if (!r.ok) return fail(r.code);
      setOrder(r.order);
      setPending(null);
      setNote("");
      setMessage({ ok: true, text: k("done") });
    });
  };

  const review = (proofId: string, accept: boolean) => {
    setMessage(null);
    if (!accept && rejecting !== proofId) {
      setRejecting(proofId);
      return;
    }
    if (!accept && note.trim() === "") {
      setMessage({ ok: false, text: t("marketplaceSeller.orderError.reason_required") });
      return;
    }
    start(async () => {
      const r = await reviewProofAction(proofId, accept, accept ? "" : note);
      if (!r.ok) return fail(r.code);
      setOrder(r.order);
      setRejecting(null);
      setNote("");
      setMessage({ ok: true, text: k("done") });
    });
  };

  const viewProof = (key: string) =>
    start(async () => {
      const r = await proofImageUrlAction(key);
      if (r.ok) window.open(r.url, "_blank", "noopener");
      else fail(r.code);
    });

  const actions = sellerActionsFor(order);
  const needsDeposit = order.status === "pending_confirmation" && order.payment_method === "instapay" && !depositSettled(order);
  const place =
    order.fulfilment === "delivery"
      ? [order.governorate_key ? governorateName(order.governorate_key, locale) : "", order.governorate_key && order.area_key ? areaName(order.governorate_key, order.area_key, locale) : ""]
          .filter(Boolean)
          .join(" — ")
      : order.pickup_address ?? "";

  return (
    <div className="grid gap-lg desktop:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-lg">
        <section className={card} aria-labelledby="so-items">
          <h2 id="so-items" className="flex items-center gap-sm text-title text-fg"><StorefrontIcon size={20} />{k("section.items")}</h2>
          <div className="mt-md overflow-x-auto">
            <table className="w-full min-w-[32rem] text-body">
              <thead className="border-b text-label text-fg-secondary">
                <tr>
                  <th className="p-xs text-start font-medium">{k("section.items")}</th>
                  <th className="p-xs text-start font-medium">{k("sku")}</th>
                  <th className="p-xs text-start font-medium">{k("qty")}</th>
                  <th className="p-xs text-start font-medium">{k("unitPrice")}</th>
                  <th className="p-xs text-start font-medium">{k("lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.sku} className="border-b last:border-0">
                    <td className="p-xs">{locale === "ar" ? i.name_ar || i.name_en : i.name_en || i.name_ar}</td>
                    <td className="p-xs"><bdi dir="ltr">{i.sku}</bdi></td>
                    <td className="p-xs tabular-nums">{i.quantity}</td>
                    <td className="p-xs tabular-nums">{money(i.unit_price_egp)}</td>
                    <td className="p-xs tabular-nums">{money(i.line_total_egp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-md grid grid-cols-[1fr_auto] gap-x-md gap-y-1 text-body">
            <dt className="text-fg-secondary">{k("subtotal")}</dt><dd className="tabular-nums">{money(order.subtotal_egp)}</dd>
            <dt className="text-fg-secondary">{k("deliveryFee")}</dt><dd className="tabular-nums">{money(order.delivery_fee_egp)}</dd>
            <dt className="font-semibold">{k("total")}</dt><dd className="font-semibold tabular-nums">{money(order.total_egp)}</dd>
            {order.deposit_percent !== null ? (
              <>
                <dt className="text-fg-secondary">{k("deposit").replace("{p}", String(order.deposit_percent))}</dt>
                <dd className="tabular-nums">{money(order.deposit_egp)}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className={card} aria-labelledby="so-buyer">
          <h2 id="so-buyer" className="flex items-center gap-sm text-title text-fg"><UserIcon size={20} />{k("section.buyer")}</h2>
          <dl className="mt-md grid grid-cols-[auto_1fr] gap-x-md gap-y-1 text-body">
            <dt className="text-fg-secondary">{k("col.buyer")}</dt><dd>{order.buyer_name}</dd>
            <dt className="text-fg-secondary">{k("phone")}</dt><dd><a href={`tel:${order.buyer_phone}`} dir="ltr" className="underline-offset-2 hover:underline">{order.buyer_phone}</a></dd>
            {order.buyer_note ? (<><dt className="text-fg-secondary">{k("note")}</dt><dd>{order.buyer_note}</dd></>) : null}
          </dl>
        </section>

        <section className={card} aria-labelledby="so-recv">
          <h2 id="so-recv" className="flex items-center gap-sm text-title text-fg"><TruckIcon size={20} />{k("section.receiving")}</h2>
          <p className="mt-sm text-body">{k(`fulfilment.${order.fulfilment}`)}{place ? ` — ${place}` : ""}</p>
          {order.address_text ? <p className="text-body text-fg-secondary">{k("address")}: {order.address_text}</p> : null}
          {order.cancel_reason ? <p className="mt-sm text-label text-fg-secondary">{k("cancelReason")}: {order.cancel_reason}</p> : null}
        </section>

        {order.payment_method === "instapay" ? (
          <section className={card} aria-labelledby="so-receipts">
            <h2 id="so-receipts" className="flex items-center gap-sm text-title text-fg"><ReceiptIcon size={20} />{k("section.receipts")}</h2>
            {order.proofs.length === 0 ? <p className="mt-sm text-body text-fg-secondary">{k("noReceipts")}</p> : null}
            <ul className="mt-sm flex flex-col gap-sm">
              {order.proofs.map((p) => (
                <li key={p.id} className="flex flex-col gap-sm rounded-sm border p-sm">
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <span className="text-label">{date(p.created_at)} · {k(`receiptStatus.${p.status}`)}</span>
                    <Button variant="outline" size="sm" onClick={() => viewProof(p.object_key)} disabled={busy}>
                      <EyeIcon size={16} />{k("receiptView")}
                    </Button>
                  </div>
                  {p.review_note ? <p className="text-label text-fg-secondary">{p.review_note}</p> : null}
                  {p.status === "submitted" && order.payment_status === "deposit_submitted" ? (
                    <div className="flex flex-col gap-sm">
                      {rejecting === p.id ? (
                        <label className="flex flex-col gap-1 text-label">
                          {k("rejectReason")}
                          <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        </label>
                      ) : null}
                      <div className="flex flex-wrap gap-sm">
                        <Button variant="accent" size="sm" disabled={busy} onClick={() => review(p.id, true)}>{k("receiptAccept")}</Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => review(p.id, false)}>{k("receiptReject")}</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={card} aria-labelledby="so-history">
          <h2 id="so-history" className="text-title text-fg">{k("section.timeline")}</h2>
          <ol className="mt-sm flex flex-col gap-1 text-body">
            {order.events.map((e, n) => (
              <li key={n} className="flex flex-wrap justify-between gap-sm border-b py-1 last:border-0">
                <span>
                  {t(`marketplaceSeller.orders.event.${e.action}`) === `marketplaceSeller.orders.event.${e.action}` ? e.action : t(`marketplaceSeller.orders.event.${e.action}`)}
                  {" · "}<span className="text-fg-secondary">{k(`actor.${e.actor_role}`)}</span>
                  {e.note ? <span className="text-fg-secondary"> — {e.note}</span> : null}
                </span>
                <span className="text-label text-fg-secondary">{date(e.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="flex flex-col gap-md">
        <section className={card} aria-labelledby="so-state">
          <h2 id="so-state" className="text-title text-fg">{k(`status.${order.status}`)}</h2>
          <p className="mt-1 text-label text-fg-secondary">{k(`method.${order.payment_method}`)} · {k(`payment.${order.payment_status}`)}</p>
          {needsDeposit ? <p className="mt-sm text-label text-warning" role="status">{k("confirmNeedsDeposit")}</p> : null}
          {pending ? (
            <label className="mt-md flex flex-col gap-1 text-label">
              {k("reason")}
              <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          ) : null}
          <div className="mt-md flex flex-col gap-sm">
            {actions.map((a) => (
              <Button key={a} variant={a === "cancel" || a === "fail" ? "outline" : "accent"} disabled={busy} aria-busy={busy} onClick={() => run(a)}>
                {k(`action.${a}`)}
              </Button>
            ))}
          </div>
          {message ? (
            <p role={message.ok ? "status" : "alert"} className={message.ok ? "mt-sm text-label text-success" : "mt-sm text-label text-danger"}>
              {message.text}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
