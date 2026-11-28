"use client";

import { Button, ButtonLink } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import { dateOnly, money } from "./order-parts";
import { addressLine, itemName, variantText } from "./order-model";
import { ordersCopy } from "./orders-copy";
import type { OrderInvoice, OrderWaybill } from "./order-types";

/**
 * Printable pages. Both are built only from what the order snapshot returned (never from the live catalogue or
 * address book), carry no navigation chrome in print and no seller contact element.
 */
const sheet = "mx-auto grid max-w-3xl gap-md rounded-md border bg-surface p-lg print:max-w-none print:rounded-none print:border-0 print:p-0";

function PrintBar({ backHref, backLabel, printLabel }: { backHref: string; backLabel: string; printLabel: string }) {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-between gap-sm print:hidden">
      <ButtonLink href={backHref} variant="outline">{backLabel}</ButtonLink>
      <Button onClick={() => window.print()}>{printLabel}</Button>
    </div>
  );
}

/** An ORDER invoice (prices exclude VAT); explicitly not a tax invoice. */
export function InvoiceView({ invoice, backHref }: { invoice: OrderInvoice; backHref: string }) {
  const { locale } = useI18n();
  const c = ordersCopy[locale];
  const t = c.invoice;
  const { governorate_key: gov, area_key: areaKey } = invoice.buyer;
  const buyerPlace = gov ? [governorateName(gov, locale), areaKey ? areaName(gov, areaKey, locale) : ""].filter(Boolean).join(" — ") : "";
  const buyerAddress = [buyerPlace, addressLine(invoice.buyer.address_parts, invoice.buyer.address, locale)].filter(Boolean).join(" — ");
  return (
    <div className="grid gap-md py-md">
      <PrintBar backHref={backHref} backLabel={t.back} printLabel={t.print} />
      <article data-print-sheet className={sheet} aria-labelledby="inv-title">
        <header className="flex flex-wrap items-start justify-between gap-md border-b pb-sm">
          <div>
            <h1 id="inv-title" className="text-headline text-fg" data-plain>{t.title}</h1>
            <p className="text-label text-fg-secondary">{t.notTax}</p>
          </div>
          <dl className="text-label">
            <div className="flex gap-sm"><dt className="text-fg-secondary">{t.number}</dt><dd><bdi dir="ltr" className="font-semibold">{invoice.invoice_number}</bdi></dd></div>
            <div className="flex gap-sm"><dt className="text-fg-secondary">{t.issued}</dt><dd>{dateOnly(invoice.issued_at, locale)}</dd></div>
          </dl>
        </header>
        <section className="grid gap-md tablet:grid-cols-2">
          <div>
            <h2 className="text-label font-semibold text-fg-secondary" data-plain>{t.seller}</h2>
            <p className="font-medium">{invoice.seller.name}</p>
            {invoice.seller.address ? <p className="text-label text-fg-secondary">{invoice.seller.address}</p> : null}
            {invoice.seller.registration_no ? <p className="text-label">{t.registration}: <bdi dir="ltr">{invoice.seller.registration_no}</bdi></p> : null}
            {invoice.seller.tax_id ? <p className="text-label">{t.taxId}: <bdi dir="ltr">{invoice.seller.tax_id}</bdi></p> : null}
          </div>
          <div>
            <h2 className="text-label font-semibold text-fg-secondary" data-plain>{t.buyer}</h2>
            <p className="font-medium">{invoice.buyer.name}</p>
            {buyerAddress ? <p className="text-label text-fg-secondary">{buyerAddress}</p> : null}
          </div>
        </section>
        <table className="w-full text-body">
          <thead className="border-b text-label text-fg-secondary">
            <tr>
              <th scope="col" className="p-xs text-start font-medium">{t.description}</th>
              <th scope="col" className="p-xs text-start font-medium">{t.sku}</th>
              <th scope="col" className="p-xs text-start font-medium">{t.qty}</th>
              <th scope="col" className="p-xs text-start font-medium">{t.unit}</th>
              <th scope="col" className="p-xs text-start font-medium">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.sku} className="border-b last:border-0">
                <td className="p-xs">{itemName(l, locale)}{l.variant_label && variantText(l.variant_label, locale) ? <span className="block text-caption text-fg-secondary">{variantText(l.variant_label, locale)}</span> : null}</td>
                <td className="p-xs"><bdi dir="ltr">{l.sku}</bdi></td>
                <td className="p-xs tabular-nums">{l.quantity}</td>
                <td className="p-xs tabular-nums">{money(l.unit_price_egp, locale)}</td>
                <td className="p-xs tabular-nums">{money(l.line_total_egp, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ms-auto grid min-w-64 gap-xs text-body">
          <div className="flex justify-between gap-md"><dt className="text-fg-secondary">{t.subtotal}</dt><dd className="tabular-nums">{money(invoice.subtotal_egp, locale)}</dd></div>
          <div className="flex justify-between gap-md"><dt className="text-fg-secondary">{t.delivery}</dt><dd className="tabular-nums">{Number(invoice.delivery_fee_egp) === 0 ? c.free : money(invoice.delivery_fee_egp, locale)}</dd></div>
          <div className="flex justify-between gap-md border-t pt-xs font-semibold"><dt>{t.grand}</dt><dd className="tabular-nums">{money(invoice.total_egp, locale)}</dd></div>
          <div className="flex justify-between gap-md text-label"><dt className="text-fg-secondary">{t.paymentMethod}</dt><dd>{c.method[invoice.payment_method]}</dd></div>
          {Number(invoice.paid_now_egp ?? 0) > 0 ? <div className="flex justify-between gap-md text-label"><dt className="text-fg-secondary">{t.paid}</dt><dd className="tabular-nums">{money(invoice.paid_now_egp, locale)}</dd></div> : null}
          {Number(invoice.balance_due_egp ?? 0) > 0 ? <div className="flex justify-between gap-md text-label"><dt className="text-fg-secondary">{t.balance}</dt><dd className="tabular-nums">{money(invoice.balance_due_egp, locale)}</dd></div> : null}
        </dl>
        <p className="text-caption text-fg-muted">{c.currencyNote}</p>
      </article>
    </div>
  );
}

/** The courier's sheet: recipient, address, items and what to collect. The recipient phone is printed because the delivery needs it. */
export function WaybillView({ waybill, backHref }: { waybill: OrderWaybill; backHref: string }) {
  const { locale } = useI18n();
  const w = ordersCopy[locale].seller.waybill;
  const gov = waybill.governorate_key;
  const area = gov && waybill.area_key ? areaName(gov, waybill.area_key, locale) : null;
  const collect = Number(waybill.payment.collect_on_delivery_egp);
  const hasPin = waybill.latitude !== null && waybill.longitude !== null;
  return (
    <div className="grid gap-md py-md">
      <PrintBar backHref={backHref} backLabel={ordersCopy[locale].seller.backToOrders} printLabel={w.print} />
      <article data-print-sheet className={sheet} aria-labelledby="wb-title">
        <header className="flex flex-wrap items-start justify-between gap-md border-b pb-sm">
          <h1 id="wb-title" className="text-headline text-fg" data-plain>{w.title}</h1>
          <p className="text-title"><span className="text-fg-secondary">{w.order} </span><bdi dir="ltr" className="font-semibold">{waybill.order_number}</bdi></p>
        </header>
        <dl className="grid gap-sm text-body">
          <div><dt className="text-label text-fg-secondary">{w.recipient}</dt><dd className="font-medium">{waybill.recipient.name}</dd></div>
          {waybill.recipient.phone ? <div><dt className="text-label text-fg-secondary">{w.phone}</dt><dd><bdi dir="ltr" className="font-medium">{waybill.recipient.phone}</bdi></dd></div> : null}
          <div><dt className="text-label text-fg-secondary">{w.address}</dt><dd>{addressLine(waybill.address_parts, waybill.address_text, locale)}</dd></div>
          {gov ? <div><dt className="text-label text-fg-secondary">{w.area}</dt><dd>{[governorateName(gov, locale), area].filter(Boolean).join(" — ")}</dd></div> : null}
          {hasPin ? <div><dt className="text-label text-fg-secondary">{w.location}</dt><dd><bdi dir="ltr">{Number(waybill.latitude).toFixed(5)}, {Number(waybill.longitude).toFixed(5)}</bdi></dd></div> : null}
          {waybill.tracking_number ? <div><dt className="text-label text-fg-secondary">{w.tracking}</dt><dd><bdi dir="ltr" className="font-medium">{waybill.tracking_number}</bdi></dd></div> : null}
          {waybill.notes ? <div><dt className="text-label text-fg-secondary">{w.notes}</dt><dd>{waybill.notes}</dd></div> : null}
        </dl>
        <table className="w-full text-body">
          <thead className="border-b text-label text-fg-secondary">
            <tr>
              <th scope="col" className="p-xs text-start font-medium">{w.items}</th>
              <th scope="col" className="p-xs text-start font-medium">{ordersCopy[locale].sku}</th>
              <th scope="col" className="p-xs text-start font-medium">{w.quantity}</th>
            </tr>
          </thead>
          <tbody>
            {waybill.items.map((i) => (
              <tr key={i.sku} className="border-b last:border-0">
                <td className="p-xs">{i.name}</td>
                <td className="p-xs"><bdi dir="ltr">{i.sku}</bdi></td>
                <td className="p-xs tabular-nums">{i.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rounded-sm border p-sm text-title">
          {collect > 0 ? (
            <>{w.collect}: <strong className="tabular-nums">{money(collect, locale)}</strong></>
          ) : (
            w.nothingToCollect
          )}
        </p>
      </article>
    </div>
  );
}
