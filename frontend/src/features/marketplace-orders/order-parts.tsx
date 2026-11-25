"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/primitives";
import { CheckIcon, PackageIcon } from "@/components/ui/icons";
import { useMarketplaceImageSrc } from "@/features/marketplace/live/image-urls";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/ui/cn";
import { formatEgp } from "@/lib/ui/egp-format";
import { EVENT_LABELS, ordersCopy } from "./orders-copy";
import { isReadyForPickup, itemName, PROGRESS_STEPS, progressIndex, timelineRows, variantText } from "./order-model";
import type { OrderDocumentV2, OrderLineV2, OrderStatusV2, PaymentStatusV2 } from "./order-types";

export const dateTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export const dateOnly = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(new Date(iso));

export const money = (n: number | null | undefined, locale: Locale) => (n === null || n === undefined ? "—" : formatEgp(Number(n), locale));

/** A product photo from the order snapshot; a removed or unreachable image falls back to a neutral tile. */
export function OrderThumb({ imageId, label, size = 64 }: { imageId: string | null; label: string; size?: number }) {
  const src = useMarketplaceImageSrc();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!imageId || failed) {
    return (
      <span role="img" aria-label={label} style={box} className="grid flex-none place-items-center rounded-sm border bg-surface-2 text-fg-muted">
        <PackageIcon size={Math.round(size / 2.5)} aria-hidden="true" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the media Worker / route, sized by the box
    <img src={src(imageId, "thumb")} alt={label} style={box} loading="lazy" onError={() => setFailed(true)} className="flex-none rounded-sm border bg-surface-2 object-cover" />
  );
}

const statusTone = (s: OrderStatusV2): "neutral" | "success" | "warning" | "danger" | "info" =>
  s === "delivered" ? "success" : s === "cancelled" || s === "delivery_failed" || s === "returned" ? "danger" : s === "shipped" ? "info" : "warning";

export function StatusBadge({ status, locale, pickupReady = false }: { status: OrderStatusV2; locale: Locale; pickupReady?: boolean }) {
  const c = ordersCopy[locale];
  return <Badge tone={statusTone(status)}>{pickupReady ? c.readyForPickup : c.status[status]}</Badge>;
}

export function PaymentBadge({ status, locale }: { status: PaymentStatusV2; locale: Locale }) {
  const tone = status === "receipt_disputed" || status === "deposit_rejected" || status === "not_collected" ? "danger" : status === "collected" || status === "receipt_accepted" || status === "deposit_accepted" ? "success" : "neutral";
  return <Badge tone={tone}>{ordersCopy[locale].payment[status]}</Badge>;
}

/** placed -> preparing -> shipped -> delivered (Noon / Amazon style); a cancelled order has no bar. */
export function ProgressBar({ status, fulfilment, locale }: { status: OrderStatusV2; fulfilment: "delivery" | "pickup"; locale: Locale }) {
  const c = ordersCopy[locale].buyer;
  const at = progressIndex(status, fulfilment);
  if (at === null) return null;
  const pickupReady = isReadyForPickup(status, fulfilment);
  return (
    <ol aria-label={c.progressLabel} className="grid grid-cols-4 gap-xs">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i < at || (i === at && status === "delivered");
        const current = i === at && !done;
        const label = step === "preparing" && pickupReady ? ordersCopy[locale].readyForPickup : c.steps[step];
        return (
          <li key={step} aria-current={current ? "step" : undefined} className="flex flex-col gap-xs">
            <span className={cn("h-1.5 rounded-pill", done || current ? "bg-accent-solid" : "bg-surface-2")} aria-hidden="true" />
            <span className={cn("flex items-center gap-1 text-label", done || current ? "font-semibold text-fg" : "text-fg-muted")}>
              {done ? <CheckIcon size={14} aria-hidden="true" /> : null}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One line of an order: photo, name, option label, quantity and price (all from the order snapshot). */
export function OrderLineRow({ line, locale, showSku = false }: { line: OrderLineV2; locale: Locale; showSku?: boolean }) {
  const c = ordersCopy[locale];
  const name = itemName(line, locale);
  const variant = variantText(line.variant_label, locale);
  return (
    <li className="flex items-start gap-md py-sm">
      <OrderThumb imageId={line.image_id} label={name || c.imageUnavailable} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-fg">{name}</p>
        {variant ? <p className="text-label text-fg-secondary">{variant}</p> : null}
        {showSku ? (
          <p className="text-caption text-fg-muted">
            {c.sku}: <bdi dir="ltr">{line.sku}</bdi>
          </p>
        ) : null}
        <p className="text-label text-fg-secondary tabular-nums">
          {line.quantity} × {money(line.unit_price_egp, locale)}
        </p>
      </div>
      <strong className="text-body tabular-nums text-fg">{money(line.line_total_egp, locale)}</strong>
    </li>
  );
}

export function Totals({ doc, locale }: { doc: OrderDocumentV2; locale: Locale }) {
  const c = ordersCopy[locale];
  const t = doc.totals;
  const rows: [string, string][] = [
    [c.subtotal, money(t.subtotal_egp, locale)],
    [c.deliveryFee, Number(t.delivery_fee_egp) === 0 && doc.fulfilment === "delivery" ? c.free : money(t.delivery_fee_egp, locale)],
  ];
  return (
    <dl className="grid gap-xs text-body">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-md">
          <dt className="text-fg-secondary">{k}</dt>
          <dd className="tabular-nums">{v}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-md border-t pt-xs font-semibold">
        <dt>{c.total}</dt>
        <dd className="tabular-nums">{money(t.total_egp, locale)}</dd>
      </div>
      {t.paid_now_egp !== null && Number(t.paid_now_egp) > 0 ? (
        <div className="flex justify-between gap-md text-label text-fg-secondary">
          <dt>{c.paidNow}</dt>
          <dd className="tabular-nums">{money(t.paid_now_egp, locale)}</dd>
        </div>
      ) : null}
      {t.balance_due_egp !== null && Number(t.balance_due_egp) > 0 ? (
        <div className="flex justify-between gap-md text-label text-fg-secondary">
          <dt>{c.balanceDue}</dt>
          <dd className="tabular-nums">{money(t.balance_due_egp, locale)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** The stored history, oldest first, with the timestamp of every step. Internal events never reach a buyer's document. */
export function Timeline({ events, locale, empty }: { events: OrderDocumentV2["events"]; locale: Locale; empty: string }) {
  const rows = timelineRows(events);
  if (rows.length === 0) return <p className="text-body text-fg-secondary">{empty}</p>;
  const labels = EVENT_LABELS[locale];
  const c = ordersCopy[locale];
  return (
    <ol className="grid gap-sm border-s ps-md">
      {rows.map((e) => {
        const label = labels[e.action] ?? (e.to_status && e.to_status in c.status ? c.status[e.to_status as OrderStatusV2] : e.action);
        return (
          <li key={e.id} className="relative">
            <span aria-hidden="true" className="absolute -start-[1.125rem] top-1.5 size-2 rounded-pill bg-accent-solid" />
            <p className="text-body font-medium text-fg">{label}</p>
            <p className="text-caption text-fg-muted">
              <time dateTime={e.at}>{dateTime(e.at, locale)}</time>
            </p>
            {e.note ? <p className="text-label text-fg-secondary">{e.note}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
