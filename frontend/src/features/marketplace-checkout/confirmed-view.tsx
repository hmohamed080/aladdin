"use client";

import Link from "next/link";
import { ReceiptIcon, StorefrontIcon, TruckIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { addressLine } from "@/features/marketplace-orders/order-model";
import type { OrderDocumentV2 } from "@/features/marketplace-orders/order-types";
import { checkoutCopy } from "./checkout-copy";

/** Index (0-3) of the progress step an order is on. Pure, so the thank-you page and its test agree. */
export function progressStep(status: string): number {
  if (status === "delivered") return 3;
  if (status === "shipped" || status === "ready" || status === "ready_for_pickup") return 2;
  if (status === "preparing" || status === "processing" || status === "confirmed") return 1;
  return 0;
}

/** The first word of a person's full name, for the greeting ("" when there is none). */
export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The thank-you page (Marketplace PR 12): greets the buyer, shows the order number, progress, address, payment and summary. */
export function ConfirmedView({ order }: { order: OrderDocumentV2 }) {
  const { locale } = useI18n();
  const c = checkoutCopy[locale];
  const money = (n: number | null) => (n === null ? "—" : fmtEgp(Number(n), locale));
  const step = progressStep(order.status);
  const gov = order.place.governorate_key;
  const place = gov
    ? [governorateName(gov, locale), order.place.area_key ? areaName(gov, order.place.area_key, locale) : ""].filter(Boolean).join(" — ")
    : "";
  return (
    <div className={styles.page}>
      <section className={styles.empty} role="status">
        <h1 data-plain>{c.thanksTitle(firstName(order.recipient.name))}</h1>
        <p>{c.thanksText}</p>
        <p><strong>{c.orderNumber}: </strong><span dir="ltr">{order.order_number}</span></p>
      </section>

      <section className={styles.card} aria-labelledby="ty-progress">
        <h2 id="ty-progress" className={styles.cardTitle} data-plain><TruckIcon size={20} aria-hidden="true" />{c.progress}</h2>
        <ol>
          {c.steps.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} style={{ fontWeight: i === step ? 700 : 400, opacity: i <= step ? 1 : 0.55 }}>
              {i < step ? "✓ " : i === step ? "● " : "○ "}{label}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="ty-where">
        <h2 id="ty-where" className={styles.cardTitle} data-plain><StorefrontIcon size={20} aria-hidden="true" />{order.fulfilment === "pickup" ? c.pickupAt : c.deliveryTo}</h2>
        <p>{order.fulfilment === "pickup" ? (order.pickup?.address ?? order.seller.name) : [place, addressLine(order.place.address_snapshot, order.place.address_text, locale)].filter(Boolean).join(" — ")}</p>
      </section>

      <section className={styles.card} aria-labelledby="ty-sum">
        <h2 id="ty-sum" className={styles.cardTitle} data-plain><ReceiptIcon size={20} aria-hidden="true" />{c.summaryTitle}</h2>
        <ul className={styles.sellerFees}>
          {order.items.map((i) => (
            <li key={i.sku}>
              <span>{locale === "ar" ? i.name_ar || i.name_en : i.name_en || i.name_ar} × {i.quantity}</span>
              <strong>{money(i.line_total_egp)}</strong>
            </li>
          ))}
        </ul>
        <dl className={styles.totals}>
          <div><dt>{c.products}</dt><dd>{money(order.totals.subtotal_egp)}</dd></div>
          <div><dt>{c.deliveryFee}</dt><dd>{Number(order.totals.delivery_fee_egp) === 0 ? c.free : money(order.totals.delivery_fee_egp)}</dd></div>
          <div><dt><strong>{c.total}</strong></dt><dd><strong>{money(order.totals.total_egp)}</strong></dd></div>
          <div><dt>{locale === "ar" ? "طريقة الدفع" : "Payment"}</dt><dd>{c.paymentMethod[order.payment_method] ?? order.payment_method}</dd></div>
        </dl>
      </section>

      <div className={styles.actions}>
        <Link href={`/market/orders/${order.id}`} className={styles.primary}>{c.viewOrder}</Link>
        <Link href="/market/orders" className={styles.secondary}>{c.myOrders}</Link>
      </div>
    </div>
  );
}
