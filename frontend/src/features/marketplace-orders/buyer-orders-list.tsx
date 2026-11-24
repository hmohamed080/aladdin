"use client";

import Link from "next/link";
import { ReceiptIcon, SearchIcon } from "@/components/ui/icons";
import { Button, ButtonLink, Input, Select } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { BUYER_GROUPS, BUYER_PAGE_SIZE, BUYER_PERIODS, buyerOrdersHref, formatEstimate, isReadyForPickup, itemName, type BuyerOrdersQuery } from "./order-model";
import type { BuyerOrdersPage, OrderSummaryV2 } from "./order-types";
import { dateOnly, money, OrderThumb, PaymentBadge, StatusBadge } from "./order-parts";
import { ordersCopy } from "./orders-copy";

/**
 * «طلباتي» in the Noon "Orders" layout: title, product search, period filter, status groups, one card per order
 * with product photos, the expected delivery date and a link to the order. Filters travel in the address, so the
 * page is a plain GET form and the list is rendered on the server.
 */
export function BuyerOrdersList({ page, query, failed = false }: { page: BuyerOrdersPage; query: BuyerOrdersQuery; failed?: boolean }) {
  const { locale } = useI18n();
  const c = ordersCopy[locale];
  const b = c.buyer;
  const filtered = Boolean(query.search) || query.period !== "3m" || query.status !== null;
  const pages = Math.max(1, Math.ceil(page.total / BUYER_PAGE_SIZE));

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <ReceiptIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{b.title}</h1>
          <p>{b.subtitle}</p>
        </div>
      </header>

      <form method="get" action="/market/orders" role="search" aria-label={b.searchLabel} className="grid gap-sm rounded-md border bg-surface p-md tablet:grid-cols-[1fr_auto_auto] tablet:items-end">
        <label className="grid gap-1 text-label text-fg-secondary">
          {b.searchLabel}
          <span className="relative block">
            <SearchIcon size={16} aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-fg-muted" />
            <Input name="q" type="search" defaultValue={query.search} placeholder={b.searchPlaceholder} maxLength={80} className="ps-9" />
          </span>
        </label>
        <label className="grid gap-1 text-label text-fg-secondary">
          {b.periodLabel}
          <Select name="period" defaultValue={query.period} aria-label={b.periodLabel}>
            {BUYER_PERIODS.map((p) => (
              <option key={p} value={p}>{b.periods[p]}</option>
            ))}
          </Select>
        </label>
        {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
        <Button type="submit">{b.searchButton}</Button>
      </form>

      <nav aria-label={b.title} className="flex flex-wrap gap-sm">
        {[null, ...BUYER_GROUPS].map((g) => (
          <Link
            key={g ?? "all"}
            href={buyerOrdersHref({ ...query, status: g, page: 1 })}
            aria-current={query.status === g ? "page" : undefined}
            className={cn("rounded-pill border px-sm py-1 text-label", query.status === g ? "border-accent bg-accent-solid/10 font-semibold text-fg" : "text-fg-secondary hover:text-fg")}
          >
            {g ? b.groups[g] : b.groups.all}
          </Link>
        ))}
      </nav>

      {failed ? (
        <section className={styles.empty} role="alert">
          <p>{c.loadFailed}</p>
          <ButtonLink href={buyerOrdersHref(query)} variant="outline">{c.retry}</ButtonLink>
        </section>
      ) : page.items.length === 0 ? (
        <section className={styles.empty}>
          <h2 data-plain>{filtered ? b.emptyFilteredTitle : b.emptyTitle}</h2>
          <p>{filtered ? b.emptyFilteredBody : b.emptyBody}</p>
          {filtered ? (
            <ButtonLink href="/market/orders" variant="outline">{b.clearFilters}</ButtonLink>
          ) : (
            <ButtonLink href="/market">{b.continueShopping}</ButtonLink>
          )}
        </section>
      ) : (
        <>
          <p role="status" className="text-label text-fg-secondary">{b.resultCount(page.total)}</p>
          <ul className="grid gap-md">
            {page.items.map((o) => (
              <li key={o.id}>
                <OrderCard order={o} />
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={b.pageOf(query.page, pages)} className="flex items-center justify-between gap-md">
              {query.page > 1 ? <ButtonLink href={buyerOrdersHref({ ...query, page: query.page - 1 })} variant="outline">{b.prev}</ButtonLink> : <span />}
              <span className="text-label text-fg-secondary">{b.pageOf(query.page, pages)}</span>
              {query.page < pages ? <ButtonLink href={buyerOrdersHref({ ...query, page: query.page + 1 })} variant="outline">{b.next}</ButtonLink> : <span />}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: OrderSummaryV2 }) {
  const { locale } = useI18n();
  const c = ordersCopy[locale];
  const b = c.buyer;
  const estimate = order.status === "delivered" || order.status === "cancelled" ? null : formatEstimate(order.estimate, locale);
  const extra = order.item_count - order.first_items.reduce((n, i) => n + i.quantity, 0);
  return (
    <article className="rounded-md border bg-surface p-md shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h2 className="text-title text-fg" data-plain>
            <Link href={`/market/orders/${order.id}`} className="underline-offset-2 hover:underline">
              <bdi dir="ltr">{order.order_number}</bdi>
            </Link>
          </h2>
          <p className="text-label text-fg-secondary">
            {b.placedOn} {dateOnly(order.placed_at, locale)} · {b.seller} {order.seller_name} · {c.pieces(order.item_count)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <StatusBadge status={order.status} locale={locale} pickupReady={isReadyForPickup(order.status, order.fulfilment)} />
          <PaymentBadge status={order.payment_status} locale={locale} />
        </div>
      </header>
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        {order.first_items.map((i, k) => (
          <OrderThumb key={k} imageId={i.image_id} label={itemName(i, locale) || c.imageUnavailable} size={56} />
        ))}
        {extra > 0 ? <span className="text-label text-fg-secondary">{b.moreItems(extra)}</span> : null}
      </div>
      <footer className="mt-sm flex flex-wrap items-center justify-between gap-sm">
        <div className="text-label text-fg-secondary">
          {order.status === "delivered" && order.delivered_at ? (
            <span>{b.deliveredOn} {dateOnly(order.delivered_at, locale)}</span>
          ) : estimate ? (
            <span>{b.expected}: <strong className="text-fg">{estimate}</strong></span>
          ) : null}
          {order.action_needed ? <p className="font-semibold text-warning">{b.needsReceipt}</p> : null}
        </div>
        <div className="flex items-center gap-md">
          <strong className="tabular-nums text-fg">{money(order.total_egp, locale)}</strong>
          <ButtonLink href={`/market/orders/${order.id}`} variant="outline" size="sm">{b.viewOrder}</ButtonLink>
        </div>
      </footer>
    </article>
  );
}
