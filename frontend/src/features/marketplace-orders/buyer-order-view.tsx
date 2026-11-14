"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ReceiptIcon, StorefrontIcon, TruckIcon, UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { cancelBuyerOrderAction, confirmProofAction, proofImageUrlAction, requestProofUploadAction } from "@/server/actions/marketplace-orders";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { buyerCopy, buyerError } from "./buyer-copy";
import { buyerCanCancel, buyerMaySendProof, type OrderDocument } from "./contract";

/** One order as its buyer sees it: items, receiving, payment, the InstaPay step and the history. */
export function BuyerOrderView({ initial }: { initial: OrderDocument }) {
  const { locale, dir } = useI18n();
  const c = buyerCopy[locale];
  const [order, setOrder] = useState(initial);
  const [busy, setBusy] = useState<"cancel" | "upload" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const money = (n: number | null) => (n === null ? "—" : fmtEgp(Number(n), locale));
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const chevron = dir === "rtl" ? "‹" : "›";
  // payment steps (receipts, collection) are told by the payment state, the rest by the order state
  const eventLabel = (e: OrderDocument["events"][number]) => {
    const pay = e.to_payment && e.to_payment in c.paymentStatus ? c.paymentStatus[e.to_payment as keyof typeof c.paymentStatus] : null;
    const st = e.to_status && e.to_status in c.status ? c.status[e.to_status as keyof typeof c.status] : null;
    return (e.action.startsWith("deposit") || e.action === "collect" ? pay ?? st : st ?? pay) ?? e.action;
  };
  const lastRejected = [...order.proofs].reverse().find((p) => p.status === "rejected");

  const cancel = async () => {
    setBusy("cancel");
    setMessage(null);
    const r = await cancelBuyerOrderAction(order.id, reason);
    setBusy(null);
    if (!r.ok) return setMessage({ ok: false, text: buyerError(locale, r.code) });
    setOrder(r.order);
    setCancelOpen(false);
    setMessage({ ok: true, text: c.cancelled });
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setMessage(null);
    if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(f.type)) return setMessage({ ok: false, text: buyerError(locale, "image_type_invalid") });
    if (f.size > MARKETPLACE_IMAGE_MAX_BYTES) return setMessage({ ok: false, text: buyerError(locale, "file_too_large") });
    setBusy("upload");
    try {
      const ticket = await requestProofUploadAction(order.id, f.type, f.size);
      if (!ticket.ok) return setMessage({ ok: false, text: buyerError(locale, ticket.code) });
      try {
        await uploadWithGrant(ticket.grant, f);
      } catch {
        return setMessage({ ok: false, text: buyerError(locale, "upload_failed") });
      }
      const done = await confirmProofAction(ticket.proofId, ticket.objectKey);
      if (!done.ok) return setMessage({ ok: false, text: buyerError(locale, done.code) });
      setOrder(done.order);
      setMessage({ ok: true, text: c.receiptSent });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  const viewProof = async (key: string) => {
    const r = await proofImageUrlAction(key);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else setMessage({ ok: false, text: buyerError(locale, r.code) });
  };

  return (
    <div className={styles.page}>
      <nav aria-label={c.myOrders}>
        <ol className={styles.crumbs}>
          <li><Link href="/marketplace">{c.marketplace}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li><Link href="/marketplace/orders">{c.myOrders}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li aria-current="page"><bdi dir="ltr">{order.order_number}</bdi></li>
        </ol>
      </nav>
      <header className={styles.head}>
        <ReceiptIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{c.orderTitle(order.order_number)}</h1>
          <p>{c.status[order.status]} · {c.paymentStatus[order.payment_status]}</p>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.card} aria-labelledby="bo-items">
            <h2 id="bo-items" className={styles.cardTitle} data-plain><StorefrontIcon size={20} aria-hidden="true" />{order.seller_name}</h2>
            <ul className={styles.sellerFees}>
              {order.items.map((i) => (
                <li key={i.sku}>
                  <span>{locale === "ar" ? i.name_ar || i.name_en : i.name_en || i.name_ar} × {i.quantity} <small className={styles.muted}>(<bdi dir="ltr">{i.sku}</bdi>)</small></span>
                  <strong>{money(i.line_total_egp)}</strong>
                </li>
              ))}
            </ul>
            <dl className={styles.totals}>
              <div><dt>{c.products}</dt><dd>{money(order.subtotal_egp)}</dd></div>
              <div><dt>{c.deliveryLine}</dt><dd>{money(order.delivery_fee_egp)}</dd></div>
              <div><dt><strong>{c.total}</strong></dt><dd><strong>{money(order.total_egp)}</strong></dd></div>
            </dl>
          </section>

          <section className={styles.card} aria-labelledby="bo-recv">
            <h2 id="bo-recv" className={styles.cardTitle} data-plain><TruckIcon size={20} aria-hidden="true" />{c.receiving}</h2>
            {order.fulfilment === "delivery" ? (
              <p>
                {c.deliverTo}: {order.governorate_key ? governorateName(order.governorate_key, locale) : ""}
                {order.governorate_key && order.area_key ? ` — ${areaName(order.governorate_key, order.area_key, locale)}` : ""}
                {order.address_text ? `، ${order.address_text}` : ""}
              </p>
            ) : (
              <p>{c.pickupFrom}: {order.seller_name}{order.pickup_address ? ` — ${order.pickup_address}` : ""}</p>
            )}
            <p className={styles.muted}>{c.placedOn} {date(order.created_at)}</p>
            {order.cancel_reason ? <p className={styles.muted}>{c.cancelReasonLabel}: {order.cancel_reason}</p> : null}
          </section>

          {order.payment_method === "instapay" ? (
            <section className={styles.card} aria-labelledby="bo-pay">
              <h2 id="bo-pay" className={styles.cardTitle} data-plain><ReceiptIcon size={20} aria-hidden="true" />{c.instapayTitle}</h2>
              <p>{c.instapaySend(money(order.deposit_egp))}</p>
              <dl className={styles.totals}>
                <div><dt>{c.instapayTo}</dt><dd><bdi dir="ltr">{order.instapay_address}</bdi></dd></div>
                <div><dt>{c.instapayName}</dt><dd>{order.instapay_account_name}</dd></div>
              </dl>
              {lastRejected && order.payment_status === "deposit_rejected" ? (
                <p className={styles.warn} role="status">{c.receiptRejected(lastRejected.review_note ?? "")}</p>
              ) : null}
              {buyerMaySendProof(order) ? (
                <div className={styles.details}>
                  <label className={styles.checkout} aria-busy={busy === "upload"}>
                    <UploadIcon size={18} aria-hidden="true" />
                    {busy === "upload" ? c.uploading : c.uploadReceipt}
                    <input ref={file} type="file" accept={MARKETPLACE_IMAGE_ALLOWED_TYPES.join(",")} className="sr-only"
                      disabled={busy !== null} onChange={(e) => upload(e.target.files?.[0])} />
                  </label>
                  <p className={styles.hint}>{c.receiptHint}</p>
                </div>
              ) : null}
              {order.proofs.length > 0 ? (
                <>
                  <h3 className={styles.feeRow}><span>{c.receipts}</span></h3>
                  <ul className={styles.sellerFees}>
                    {order.proofs.map((p) => (
                      <li key={p.id}>
                        <button type="button" className={styles.linkButton} onClick={() => viewProof(p.object_key)}>{date(p.created_at)}</button>
                        <strong>{c.receiptStatus[p.status]}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          <section className={styles.card} aria-labelledby="bo-history">
            <h2 id="bo-history" className={styles.cardTitle} data-plain>{c.history}</h2>
            <ol className={styles.sellerFees}>
              {order.events.map((e, n) => (
                <li key={n}>
                  <span>{eventLabel(e)}{e.note ? ` — ${e.note}` : ""}</span>
                  <small className={styles.muted}>{date(e.at)}</small>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className={styles.side}>
          <div className={styles.actions}>
            {message ? <p role={message.ok ? "status" : "alert"} className={message.ok ? styles.hint : styles.warn}>{message.text}</p> : null}
            {buyerCanCancel(order) ? (
              cancelOpen ? (
                <div className={styles.details}>
                  <label className={styles.field}>
                    <span>{c.cancelReason}</span>
                    <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  <button type="button" className={styles.checkout} disabled={busy !== null} aria-busy={busy === "cancel"} onClick={cancel}>{c.cancelConfirm}</button>
                </div>
              ) : (
                <button type="button" className={styles.secondary} onClick={() => setCancelOpen(true)}>{c.cancel}</button>
              )
            ) : null}
            <Link href="/marketplace/orders" className={styles.secondary}>{c.myOrders}</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
