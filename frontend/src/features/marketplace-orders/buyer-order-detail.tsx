"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { ReceiptIcon, StorefrontIcon, TruckIcon } from "@/components/ui/icons";
import { Button, ButtonLink, Textarea } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { proofImageUrlAction } from "@/server/actions/marketplace-orders";
import { buyerCancelOrderPageAction, confirmResubmitAction, reasonPresetsAction, requestResubmitUploadAction } from "@/server/actions/marketplace-order-pages";
import { syncMarketplaceCartAction } from "@/server/actions/marketplace-cart-account";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { writeAccountCartLines } from "@/features/marketplace/live/live-cart-store";
import { FileComplaintSlot } from "./order-slots";
import { CancelRefund } from "./cancel-refund";
import { OrderReturnLinks } from "./order-returns";
import { addressLine, formatEstimate, hoursLeft, isInstapay, isLegacy, isReadyForPickup, knownActions, reorderLines } from "./order-model";
import type { OrderDocumentV2, ReasonPreset } from "./order-types";
import { dateTime, OrderLineRow, PaymentBadge, ProgressBar, StatusBadge, Timeline, Totals } from "./order-parts";
import { orderError, ordersCopy } from "./orders-copy";

type Msg = { ok: boolean; text: string } | null;
const card = "rounded-md border bg-surface p-md shadow-card";
const h2 = "mb-sm flex items-center gap-sm text-title text-fg";

/** One order as its buyer sees it (Noon layout). Buttons come from `document.actions` only; the database re-checks each one. */
export function BuyerOrderDetail({ initial }: { initial: OrderDocumentV2 }) {
  const { locale, dir } = useI18n();
  const router = useRouter();
  const c = ordersCopy[locale];
  const b = c.buyer;
  const [order, setOrder] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<"reorder" | "cancel" | "upload" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [presets, setPresets] = useState<ReasonPreset[] | null>(null);
  const [presetId, setPresetId] = useState("");
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const chevron = dir === "rtl" ? "‹" : "›";
  const legacy = isLegacy(order);
  const estimate = ["delivered", "cancelled", "returned"].includes(order.status) ? null : formatEstimate(order.delivery.estimate, locale);
  const pickupReady = isReadyForPickup(order.status, order.fulfilment);
  const ship = order.delivery.shipment;
  const gov = order.place.governorate_key;
  const place = gov ? [governorateName(gov, locale), order.place.area_key ? areaName(gov, order.place.area_key, locale) : ""].filter(Boolean).join(" — ") : "";
  const left = hoursLeft(order.payment.dispute?.resubmit_due_at ?? order.timers.receipt_resubmit_due_at, new Date());
  const invoiceReady = order.invoice !== null || ["ready", "shipped", "delivered", "delivery_failed", "returned"].includes(order.status);
  const canceller = order.cancellation?.by;

  const openCancel = async () => {
    setCancelOpen(true);
    setMsg(null);
    if (presets === null) {
      const r = await reasonPresetsAction("order_cancel_buyer");
      setPresets(r.ok ? r.presets : []);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setMsg(null);
    const r = await buyerCancelOrderPageAction(order.id, presetId || null, note);
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: orderError(locale, r.code) });
    setOrder(r.order);
    setCancelOpen(false);
    setMsg({ ok: true, text: b.cancelled });
  };

  const reorder = async () => {
    const lines = reorderLines(order.items);
    if (lines.length === 0) return;
    setBusy("reorder");
    setMsg(null);
    const r = await syncMarketplaceCartAction({ mode: "merge", key: crypto.randomUUID(), lines });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.code === "own_showroom" ? b.reorderOwn : orderError(locale, r.code === "closed" ? "marketplace_closed" : "unexpected") });
    // the cart page renders the browser cart: adopt the merged account cart before going there
    writeAccountCartLines(r.lines);
    setMsg({ ok: true, text: b.reorderDone });
    router.push("/market/cart");
  };

  const resubmit = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(f.type)) return setMsg({ ok: false, text: orderError(locale, "image_type_invalid") });
    if (f.size > MARKETPLACE_IMAGE_MAX_BYTES) return setMsg({ ok: false, text: orderError(locale, "file_too_large") });
    setBusy("upload");
    try {
      const ticket = await requestResubmitUploadAction(order.id, f.type, f.size);
      if (!ticket.ok) return setMsg({ ok: false, text: orderError(locale, ticket.code) });
      try {
        await uploadWithGrant(ticket.grant, f, { namespace: "marketplace", key: ticket.objectKey });
      } catch {
        return setMsg({ ok: false, text: orderError(locale, "upload_failed") });
      }
      const done = await confirmResubmitAction(ticket.proofId, ticket.objectKey);
      if (!done.ok) return setMsg({ ok: false, text: orderError(locale, done.code) });
      setOrder(done.order);
      setMsg({ ok: true, text: b.resubmitDone });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  const viewReceipt = async (key: string) => {
    const r = await proofImageUrlAction(key);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else setMsg({ ok: false, text: orderError(locale, r.code) });
  };

  // Registry keyed by action name; a name this page does not know (a later PR's button) is ignored.
  const registry: Record<string, () => ReactNode> = {
    cancel: () =>
      cancelOpen ? (
        <section key="cancel" aria-labelledby="bo-cancel" className="grid gap-sm rounded-sm border border-danger/40 p-md">
          <h3 id="bo-cancel" className="text-body font-semibold text-fg">{b.cancelTitle}</h3>
          <p className="text-label text-fg-secondary">{b.cancelBody}</p>
          {presets && presets.length > 0 ? (
            <fieldset className="grid gap-xs">
              <legend className="text-label text-fg-secondary">{b.cancelReasonOptional}</legend>
              {presets.map((p) => (
                <label key={p.id} className="flex items-center gap-sm text-body">
                  <input type="radio" name="cancel-reason" value={p.id} checked={presetId === p.id} onChange={() => setPresetId(p.id)} />
                  {locale === "ar" ? p.label_ar : p.label_en}
                </label>
              ))}
              <label className="flex items-center gap-sm text-body">
                <input type="radio" name="cancel-reason" value="" checked={presetId === ""} onChange={() => setPresetId("")} />
                {b.cancelOther}
              </label>
            </fieldset>
          ) : null}
          <label className="grid gap-1 text-label text-fg-secondary">
            {b.cancelNoteLabel}
            <Textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-sm">
            <Button variant="danger" onClick={cancel} disabled={busy !== null}>{b.cancelConfirm}</Button>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy !== null}>{b.cancelKeep}</Button>
          </div>
        </section>
      ) : (
        <div key="cancel" className="grid gap-1">
          <Button variant="danger" onClick={openCancel}>{b.cancel}</Button>
          <p className="text-caption text-fg-muted">{b.cancelOnlyBefore}</p>
        </div>
      ),
    resubmit_receipt: () => (
      <section key="resubmit" aria-labelledby="bo-dispute" className="grid gap-sm rounded-sm border border-warning/50 bg-warning/10 p-md">
        <h3 id="bo-dispute" className="text-body font-semibold text-fg">{b.disputeTitle}</h3>
        <p className="text-label text-fg-secondary">
          {(locale === "ar" ? order.payment.dispute?.message_ar : order.payment.dispute?.message_en) || b.disputeBody}
        </p>
        {left !== null ? <p className="text-label font-semibold text-fg">{b.disputeHours(left)}</p> : null}
        <p className="text-caption text-fg-muted">{b.disputeAuto}</p>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => resubmit(e.target.files?.[0])} />
        <Button onClick={() => file.current?.click()} disabled={busy !== null}>{busy === "upload" ? b.resubmitBusy : b.resubmitButton}</Button>
        <p className="text-caption text-fg-muted">{b.fileHint}</p>
      </section>
    ),
  };
  registry.file_complaint = () => <FileComplaintSlot key="file_complaint" orderId={order.id} />;
  registry.confirm_cancel_refund = () => <CancelRefund key="confirm_cancel_refund" order={order} mode="confirm" onDone={setOrder} />;
  for (const kind of ["return", "exchange"] as const) {
    registry[`request_${kind}`] = () => (
      <ButtonLink href={`/market/returns/new?order=${order.id}&kind=${kind}`} variant="outline" className="w-full">
        {kind === "return" ? b.requestReturn : b.requestExchange}
      </ButtonLink>
    );
  }
  const buttons = knownActions(order.actions, registry);

  return (
    <div className={styles.page}>
      <nav aria-label={b.myOrders}>
        <ol className={styles.crumbs}>
          <li><Link href="/market">{b.marketplace}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li><Link href="/market/orders">{b.myOrders}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li aria-current="page"><bdi dir="ltr">{order.order_number}</bdi></li>
        </ol>
      </nav>
      <header className={styles.head}>
        <ReceiptIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{b.orderTitle(order.order_number)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-xs">
            <StatusBadge status={order.status} locale={locale} pickupReady={pickupReady} />
            <PaymentBadge status={order.payment_status} locale={locale} />
          </p>
        </div>
      </header>

      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-sm border p-sm text-label ${msg.ok ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>{msg.text}</p>
      ) : null}
      {legacy ? <p className="rounded-sm border bg-surface-2 p-sm text-label text-fg-secondary">{b.legacyNote}</p> : null}

      {order.status === "cancelled" ? (
        <section role="status" className="rounded-md border border-danger/40 bg-danger/10 p-md">
          <p className="font-semibold text-fg">{canceller === "buyer" ? b.cancelledByYou : canceller === "seller" ? b.cancelledBySeller : canceller === "system" ? b.cancelledBySystem : b.cancelledBanner}</p>
          {(locale === "ar" ? order.cancellation?.message_ar : order.cancellation?.message_en) ? (
            <p className="text-label text-fg-secondary">{b.cancelReasonLabel}: {locale === "ar" ? order.cancellation?.message_ar : order.cancellation?.message_en}</p>
          ) : null}
        </section>
      ) : order.status === "returned" ? (
        <p role="status" className="rounded-md border bg-surface-2 p-md">{b.returnedBanner}</p>
      ) : order.status === "delivery_failed" ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-md">{b.deliveryFailedBanner}</p>
      ) : (
        <section className={card} aria-label={b.progressLabel}>
          <ProgressBar status={order.status} fulfilment={order.fulfilment} locale={locale} />
          {estimate ? (
            <p className="mt-sm text-body">
              {b.expectedDelivery}: <strong>{estimate}</strong>
            </p>
          ) : null}
          {order.status === "shipped" ? <p className="text-label text-fg-secondary">{b.shippedHelp}</p> : null}
        </section>
      )}

      <div className={styles.layout}>
        <div className={styles.main}>
          <section className={card} aria-labelledby="bo-items">
            <h2 id="bo-items" className={h2} data-plain><StorefrontIcon size={20} aria-hidden="true" />{order.seller.name}</h2>
            <ul className="divide-y">
              {order.items.map((i) => (
                <OrderLineRow key={i.id} line={i} locale={locale} />
              ))}
            </ul>
            <div className="mt-sm"><Totals doc={order} locale={locale} /></div>
            <p className="mt-xs text-caption text-fg-muted">{c.currencyNote}</p>
          </section>

          <section className={card} aria-labelledby="bo-recv">
            <h2 id="bo-recv" className={h2} data-plain><TruckIcon size={20} aria-hidden="true" />{order.fulfilment === "pickup" ? b.pickupAt : b.deliverTo}</h2>
            {order.fulfilment === "pickup" ? (
              <p>{order.pickup?.address ?? order.seller.name}{order.pickup?.instructions ? <><br /><span className="text-label text-fg-secondary">{order.pickup.instructions}</span></> : null}</p>
            ) : (
              <p>
                {[place, addressLine(order.place.address_snapshot, order.place.address_text, locale)].filter(Boolean).join(" — ")}
                <br />
                <span className="text-label text-fg-secondary">
                  {b.recipient}: {order.recipient.name}{order.recipient.phone ? <> · <bdi dir="ltr">{order.recipient.phone}</bdi></> : null}
                </span>
              </p>
            )}
            {ship ? (
              <dl className="mt-sm grid gap-xs text-body">
                <div className="flex gap-sm"><dt className="text-fg-secondary">{b.shipment}</dt><dd>{dateTime(ship.shipped_at, locale)}</dd></div>
                {ship.carrier_name ? <div className="flex gap-sm"><dt className="text-fg-secondary">{b.carrier}</dt><dd>{ship.carrier_name}</dd></div> : null}
                {ship.tracking_number ? <div className="flex gap-sm"><dt className="text-fg-secondary">{b.tracking}</dt><dd><bdi dir="ltr" className="font-semibold">{ship.tracking_number}</bdi></dd></div> : null}
              </dl>
            ) : order.fulfilment === "delivery" && !legacy && ["new", "preparing", "ready"].includes(order.status) ? (
              <p className="mt-sm text-label text-fg-muted">{b.noTrackingYet}</p>
            ) : null}
          </section>

          <section className={card} aria-labelledby="bo-pay">
            <h2 id="bo-pay" className={h2} data-plain><ReceiptIcon size={20} aria-hidden="true" />{b.paymentTitle}</h2>
            <p>{c.method[order.payment_method]} · {c.payment[order.payment_status]}</p>
            {isInstapay(order.payment_method) && order.payment.instapay ? (
              <dl className="mt-xs grid gap-xs text-label text-fg-secondary">
                <div className="flex gap-sm"><dt>{b.instapayAddress}</dt><dd><bdi dir="ltr">{order.payment.instapay.address}</bdi></dd></div>
                <div className="flex gap-sm"><dt>{b.accountName}</dt><dd>{order.payment.instapay.account_name}</dd></div>
              </dl>
            ) : null}
            {order.payment.receipts.length > 0 ? (
              <div className="mt-sm">
                <h3 className="text-label font-semibold text-fg-secondary">{b.receiptsTitle}</h3>
                <ul className="grid gap-xs">
                  {order.payment.receipts.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-sm text-body">
                      <span>{dateTime(r.created_at, locale)} · {b.receiptStatus[r.status]}</span>
                      <Button size="sm" variant="outline" onClick={() => viewReceipt(r.object_key)}>{b.viewReceipt}</Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {order.returns?.length ? (
            <section className={card} aria-labelledby="bo-returns">
              <h2 id="bo-returns" className={h2} data-plain>{b.returnsTitle}</h2>
              <OrderReturnLinks returns={order.returns} base="/market/returns" locale={locale} />
            </section>
          ) : null}

          <section className={card} aria-labelledby="bo-time">
            <h2 id="bo-time" className={h2} data-plain>{b.timelineTitle}</h2>
            <Timeline events={order.events} locale={locale} empty={b.timelineEmpty} />
          </section>
        </div>

        <aside className={styles.side} aria-label={b.orderTitle(order.order_number)}>
          <section className={`${card} grid gap-sm`}>
            {buttons.map(({ key, entry }) => <div key={key}>{entry()}</div>)}
            {!legacy && order.items.length > 0 ? (
              <Button variant="outline" onClick={reorder} disabled={busy !== null}>{busy === "reorder" ? b.reorderBusy : b.reorder}</Button>
            ) : null}
            {invoiceReady ? (
              <ButtonLink href={`/market/orders/${order.id}/invoice`} variant="outline">{b.invoice}</ButtonLink>
            ) : (
              <p className="text-caption text-fg-muted">{b.invoiceUnavailable}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
