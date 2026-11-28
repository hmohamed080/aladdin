"use client";

import { useState, type ReactNode } from "react";
import { Button, ButtonLink, Input } from "@/components/ui/controls";
import { ReceiptIcon, StorefrontIcon, TruckIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { proofImageUrlAction } from "@/server/actions/marketplace-orders";
import { sellerOrderActionPageAction, shipmentUpdateAction } from "@/server/actions/marketplace-order-pages";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import { formatEstimate, hoursLeft, isInstapay, isLegacy, isReadyForPickup, isValidCarrier, isValidTracking, knownActions, latestSubmittedReceipt, type SellerActionPayload, type SellerOrderActionName } from "./order-model";
import type { OrderDocumentV2 } from "./order-types";
import { dateTime, money, OrderLineRow, PaymentBadge, StatusBadge, Timeline, Totals } from "./order-parts";
import { ReasonPanel, type ReasonValue } from "./reason-panel";
import { orderError, ordersCopy } from "./orders-copy";
import { FileComplaintSlot } from "./order-slots";
import { CancelRefund } from "./cancel-refund";
import { OrderReturnLinks } from "./order-returns";

type Msg = { ok: boolean; text: string } | null;
type Panel = SellerOrderActionName | "shipment_edit" | null;
const card = "rounded-md border bg-surface p-md shadow-card";
const h2 = "mb-sm flex items-center gap-sm text-title text-fg";
const SIMPLE: SellerOrderActionName[] = ["start_preparing", "mark_ready", "mark_delivered", "collect_payment", "accept_receipt", "mark_delivery_failed", "mark_returned_to_stock"];

/**
 * One order as the showroom works it. The buttons are exactly the names in `document.actions`, drawn through a
 * registry keyed by action name; a name this page does not know (a later PR's button) is ignored. The database
 * re-checks every press and moves stock in the same transaction.
 */
export function SellerOrderDetail({ initial }: { initial: OrderDocumentV2 }) {
  const { locale } = useI18n();
  const c = ordersCopy[locale];
  const t = c.seller;
  const [order, setOrder] = useState(initial);
  const [open, setOpen] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [carrier, setCarrier] = useState(initial.delivery.shipment?.carrier_name ?? "");
  const [tracking, setTracking] = useState(initial.delivery.shipment?.tracking_number ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const legacy = isLegacy(order);
  const pickup = order.fulfilment === "pickup";
  const gov = order.place.governorate_key;
  const place = gov ? [governorateName(gov, locale), order.place.area_key ? areaName(gov, order.place.area_key, locale) : ""].filter(Boolean).join(" — ") : "";
  const estimate = formatEstimate(order.delivery.estimate, locale);
  const startLeft = hoursLeft(order.timers.seller_start_due_at, new Date());
  const disputeLeft = hoursLeft(order.timers.receipt_resubmit_due_at, new Date());
  const disputed = order.payment_status === "receipt_disputed";
  const invoiceReady = order.invoice !== null || ["ready", "shipped", "delivered", "delivery_failed", "returned"].includes(order.status);
  const canWaybill = order.fulfilment === "delivery" && !["cancelled", "returned"].includes(order.status);
  const waiting = latestSubmittedReceipt(order);

  const run = async (action: SellerOrderActionName, payload: SellerActionPayload = {}) => {
    setBusy(true);
    setMsg(null);
    const r = await sellerOrderActionPageAction(order.id, action, payload);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: orderError(locale, r.code) });
    setOrder(r.order);
    setOpen(null);
    setMsg({ ok: true, text: t.done });
  };

  const withReason = (action: "cancel" | "flag_receipt_not_received") => (reason: ReasonValue, internalNote: string) =>
    run(action, { ...reason, ...(action === "cancel" && internalNote.trim() ? { internal_note: internalNote } : {}) });

  const ship = async () => {
    setFieldError(null);
    if (carrier.trim() && !isValidCarrier(carrier)) return setFieldError(orderError(locale, "carrier_invalid"));
    if (tracking.trim() && !isValidTracking(tracking)) return setFieldError(orderError(locale, "tracking_invalid"));
    await run("mark_shipped", { carrier_name: carrier, tracking_number: tracking });
  };

  const saveShipment = async () => {
    setFieldError(null);
    if (carrier.trim() && !isValidCarrier(carrier)) return setFieldError(orderError(locale, "carrier_invalid"));
    if (tracking.trim() && !isValidTracking(tracking)) return setFieldError(orderError(locale, "tracking_invalid"));
    setBusy(true);
    setMsg(null);
    const r = await shipmentUpdateAction(order.id, carrier, tracking);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: orderError(locale, r.code) });
    setOrder(r.order);
    setOpen(null);
    setMsg({ ok: true, text: t.shipmentSaved });
  };

  const viewReceipt = async (key: string) => {
    const r = await proofImageUrlAction(key);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else setMsg({ ok: false, text: orderError(locale, r.code) });
  };

  const shipForm = (onConfirm: () => void, confirmLabel: string, title: string): ReactNode => (
    <section className="grid gap-sm rounded-sm border p-md" aria-label={title}>
      <h3 className="text-body font-semibold text-fg">{title}</h3>
      <label className="grid gap-1 text-label text-fg-secondary">
        {t.carrier}
        <Input value={carrier} maxLength={80} onChange={(e) => setCarrier(e.target.value)} />
      </label>
      <label className="grid gap-1 text-label text-fg-secondary">
        {t.trackingNumber}
        <Input dir="ltr" value={tracking} maxLength={64} onChange={(e) => setTracking(e.target.value)} />
        <span className="text-caption text-fg-muted">{t.trackingHelp}</span>
      </label>
      {fieldError ? <p role="alert" className="text-label text-danger">{fieldError}</p> : null}
      <div className="flex flex-wrap gap-sm">
        <Button onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>{t.confirmNo}</Button>
      </div>
    </section>
  );

  const label = (action: SellerOrderActionName) => (action === "mark_ready" && pickup ? t.actions.mark_ready_pickup : t.actions[action]);

  const simple = (action: SellerOrderActionName) => function SimpleAction() {
    return open === action ? (
      <section className="grid gap-sm rounded-sm border p-md" aria-label={label(action)}>
        <p className="text-body">{t.confirmText[action as keyof typeof t.confirmText]}</p>
        <div className="flex flex-wrap gap-sm">
          <Button onClick={() => run(action, action === "accept_receipt" && waiting ? { proof_id: waiting.id } : {})} disabled={busy}>{t.confirmYes}</Button>
          <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>{t.confirmNo}</Button>
        </div>
      </section>
    ) : (
      <Button variant={action === "mark_delivery_failed" ? "danger" : action === "start_preparing" ? "accent" : "primary"} onClick={() => { setMsg(null); setOpen(action); }}>
        {label(action)}
      </Button>
    );
  };

  // registry keyed by action name (unknown names are ignored by knownActions)
  const registry: Record<string, () => ReactNode> = {};
  for (const a of SIMPLE) registry[a] = simple(a);
  registry.mark_shipped = () =>
    open === "mark_shipped" ? shipForm(ship, t.shipConfirm, t.shipTitle) : <Button variant="accent" onClick={() => { setMsg(null); setFieldError(null); setOpen("mark_shipped"); }}>{label("mark_shipped")}</Button>;
  registry.cancel = () =>
    open === "cancel" ? (
      <ReasonPanel action="order_cancel_seller" title={t.cancelTitle} intro={t.cancelIntro} confirmLabel={t.cancelConfirm} keepLabel={t.cancelKeep} danger withInternalNote busy={busy} onSubmit={withReason("cancel")} onCancel={() => setOpen(null)} />
    ) : (
      <Button variant="danger" onClick={() => { setMsg(null); setOpen("cancel"); }}>{label("cancel")}</Button>
    );
  registry.flag_receipt_not_received = () =>
    open === "flag_receipt_not_received" ? (
      <ReasonPanel action="payment_issue" title={t.flagTitle} intro={t.flagIntro} confirmLabel={t.flagConfirm} keepLabel={t.flagKeep} busy={busy} onSubmit={withReason("flag_receipt_not_received")} onCancel={() => setOpen(null)} />
    ) : (
      <Button variant="outline" onClick={() => { setMsg(null); setOpen("flag_receipt_not_received"); }}>{label("flag_receipt_not_received")}</Button>
    );
  registry.file_complaint = () => <FileComplaintSlot orderId={order.id} />;
  registry.record_cancel_refund = () => <CancelRefund order={order} mode="record" onDone={setOrder} />;
  const buttons = knownActions(order.actions, registry);

  return (
    <div className="grid gap-lg desktop:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-lg">
        {msg ? <p role={msg.ok ? "status" : "alert"} className={`rounded-sm border p-sm text-label ${msg.ok ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>{msg.text}</p> : null}
        {legacy ? <p className="rounded-sm border bg-surface-2 p-sm text-label text-fg-secondary">{t.legacyNote}</p> : null}
        {order.status === "new" && startLeft !== null ? <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 p-sm text-label">{t.startWaiting(startLeft)}</p> : null}
        {isInstapay(order.payment_method) && order.payment_status === "receipt_submitted" && ["preparing", "ready"].includes(order.status) ? (
          <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 p-sm text-label">{t.confirmBeforeShipping}</p>
        ) : null}
        {disputed ? (
          <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 p-sm text-label">
            {t.holdWarning} {t.disputeSent} {disputeLeft !== null ? t.disputeWaiting(disputeLeft) : ""}
          </p>
        ) : null}

        <section className={card} aria-labelledby="so-items">
          <h2 id="so-items" className={h2} data-plain><StorefrontIcon size={20} aria-hidden="true" />{t.itemsTitle}</h2>
          <ul className="divide-y">
            {order.items.map((i) => (
              <OrderLineRow key={i.id} line={i} locale={locale} showSku />
            ))}
          </ul>
          <div className="mt-sm"><Totals doc={order} locale={locale} /></div>
        </section>

        <section className={card} aria-labelledby="so-buyer">
          <h2 id="so-buyer" className={h2} data-plain><UserIcon size={20} aria-hidden="true" />{t.buyerTitle}</h2>
          <p>{order.recipient.name}</p>
          {order.recipient.phone ? <p className="text-label text-fg-secondary">{t.phone}: <bdi dir="ltr">{order.recipient.phone}</bdi></p> : null}
        </section>

        <section className={card} aria-labelledby="so-recv">
          <h2 id="so-recv" className={h2} data-plain><TruckIcon size={20} aria-hidden="true" />{pickup ? t.pickupTitle : t.deliveryTitle}</h2>
          {pickup ? (
            <p>{order.pickup?.address ?? order.seller.name}</p>
          ) : (
            <p>
              {[place, order.place.address_text].filter(Boolean).join(" — ")}
            </p>
          )}
          {estimate && !["delivered", "cancelled"].includes(order.status) ? <p className="text-label text-fg-secondary">{t.estimate}: {estimate}</p> : null}
          {order.delivery.shipment ? (
            <dl className="mt-sm grid gap-xs text-body">
              <div className="flex gap-sm"><dt className="text-fg-secondary">{c.buyer.carrier}</dt><dd>{order.delivery.shipment.carrier_name ?? c.notAvailable}</dd></div>
              <div className="flex gap-sm"><dt className="text-fg-secondary">{c.buyer.tracking}</dt><dd><bdi dir="ltr">{order.delivery.shipment.tracking_number ?? c.notAvailable}</bdi></dd></div>
            </dl>
          ) : null}
          {order.status === "shipped" && !legacy ? (
            open === "shipment_edit" ? (
              <div className="mt-sm">{shipForm(saveShipment, t.shipmentSave, t.shipmentEdit)}</div>
            ) : (
              <Button className="mt-sm" size="sm" variant="outline" onClick={() => { setMsg(null); setFieldError(null); setOpen("shipment_edit"); }}>{t.shipmentEdit}</Button>
            )
          ) : null}
        </section>

        <section className={card} aria-labelledby="so-pay">
          <h2 id="so-pay" className={h2} data-plain><ReceiptIcon size={20} aria-hidden="true" />{t.paymentTitle}</h2>
          <p className="flex flex-wrap items-center gap-xs">{c.method[order.payment_method]} <PaymentBadge status={order.payment_status} locale={locale} /></p>
          {isInstapay(order.payment_method) ? (
            order.payment.receipts.length === 0 ? (
              <p className="mt-xs text-label text-fg-secondary">{t.noReceipt}</p>
            ) : (
              <ul className="mt-sm grid gap-xs">
                {order.payment.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-sm text-body">
                    <span>
                      {dateTime(r.created_at, locale)} · {c.buyer.receiptStatus[r.status]}
                      {r.declared_amount_egp ? <span className="block text-caption text-fg-secondary">{t.declared}: {money(r.declared_amount_egp, locale)}</span> : null}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => viewReceipt(r.object_key)}>{t.viewReceipt}</Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>

        {order.cancellation ? (
          <section className={card} aria-labelledby="so-cancel">
            <h2 id="so-cancel" className={h2} data-plain>{t.cancelledWith}</h2>
            <p className="text-body">{t.reasonShownToBuyer}: {(locale === "ar" ? order.cancellation.message_ar : order.cancellation.message_en) ?? c.notAvailable}</p>
            {order.cancellation.internal_note ? <p className="text-label text-fg-secondary">{t.internalNote}: {order.cancellation.internal_note}</p> : null}
          </section>
        ) : null}

        <section className={card} aria-labelledby="so-time">
          <h2 id="so-time" className={h2} data-plain>{t.timelineTitle}</h2>
          <Timeline events={order.events} locale={locale} empty={c.buyer.timelineEmpty} />
        </section>
      </div>

      <aside className="flex flex-col gap-md" aria-label={t.orderTitle(order.order_number)}>
        <section className={`${card} grid gap-sm`}>
          <p className="flex flex-wrap items-center gap-xs"><StatusBadge status={order.status} locale={locale} pickupReady={isReadyForPickup(order.status, order.fulfilment)} /></p>
          {buttons.map(({ key, entry }) => (
            <div key={key}>{entry()}</div>
          ))}
        </section>
        {order.returns?.length ? (
          <section className={`${card} grid gap-sm`}>
            <h2 className="text-body font-semibold text-fg" data-plain>{t.returnsTitle}</h2>
            <OrderReturnLinks returns={order.returns} base="/showroom/marketplace/returns" locale={locale} />
          </section>
        ) : null}
        <section className={`${card} grid gap-sm`}>
          <h2 className="text-body font-semibold text-fg" data-plain>{t.printTitle}</h2>
          {canWaybill ? <ButtonLink href={`/showroom/marketplace/orders/${order.id}/waybill`} variant="outline">{t.printWaybill}</ButtonLink> : null}
          {invoiceReady ? <ButtonLink href={`/showroom/marketplace/orders/${order.id}/invoice`} variant="outline">{t.printInvoice}</ButtonLink> : <p className="text-caption text-fg-muted">{t.invoiceAfterReady}</p>}
        </section>
      </aside>
    </div>
  );
}
