"use client";

import Link from "next/link";
import { Button, ButtonLink, Input } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { governorateName } from "@/features/marketplace-seller/place-label";
import { SELLER_PAGE_SIZE, SELLER_TABS, itemName, isReadyForPickup, sellerOrdersHref, totalOrders, type SellerOrdersQuery } from "./order-model";
import type { SellerOrdersPageV2 } from "./order-types";
import { dateOnly, money, OrderThumb, PaymentBadge, StatusBadge } from "./order-parts";
import { ordersCopy } from "./orders-copy";

/**
 * The showroom's orders: tabs (new, preparing, shipped, delivered, cancelled), search and a date filter, with the
 * product photos of every order. Everything travels in the address (a plain GET form), so the list is a server render.
 */
export function SellerOrdersList({ page, query, failed = false }: { page: SellerOrdersPageV2; query: SellerOrdersQuery; failed?: boolean }) {
  const { locale } = useI18n();
  const t = ordersCopy[locale].seller;
  const c = ordersCopy[locale];
  const pages = Math.max(1, Math.ceil(page.total / SELLER_PAGE_SIZE));
  const filtered = Boolean(query.search || query.from || query.to);
  const tab = (key: SellerOrdersQuery["tab"], label: string, count: number) => (
    <Link
      key={key ?? "all"}
      href={sellerOrdersHref({ ...query, tab: key, page: 1 })}
      aria-current={query.tab === key ? "page" : undefined}
      className={cn("rounded-pill border px-sm py-1 text-label", query.tab === key ? "border-accent bg-accent-solid/10 font-semibold text-fg" : "text-fg-secondary hover:text-fg")}
    >
      {label} <span className="tabular-nums">({count})</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-lg">
      {page.needs_attention > 0 ? (
        <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 p-sm text-label text-fg">{t.needsAttention(page.needs_attention)}</p>
      ) : null}

      <form method="get" action="/showroom/marketplace/orders" role="search" aria-label={t.searchLabel} className="grid gap-sm rounded-md border bg-surface p-md tablet:grid-cols-[1fr_auto_auto_auto] tablet:items-end">
        {query.tab ? <input type="hidden" name="tab" value={query.tab} /> : null}
        <label className="grid gap-1 text-label text-fg-secondary">
          {t.searchLabel}
          <Input name="q" type="search" defaultValue={query.search} placeholder={t.searchPlaceholder} maxLength={80} />
        </label>
        <label className="grid gap-1 text-label text-fg-secondary">
          {t.from}
          <Input name="from" type="date" defaultValue={query.from ?? ""} />
        </label>
        <label className="grid gap-1 text-label text-fg-secondary">
          {t.to}
          <Input name="to" type="date" defaultValue={query.to ?? ""} />
        </label>
        <div className="flex gap-sm">
          <Button type="submit">{t.apply}</Button>
          {filtered ? <ButtonLink href={sellerOrdersHref({ tab: query.tab })} variant="outline">{t.clear}</ButtonLink> : null}
        </div>
      </form>

      <nav className="flex flex-wrap gap-sm" aria-label={t.col.status}>
        {tab(null, t.tabs.all, totalOrders(page.counts))}
        {SELLER_TABS.map((k) => tab(k, t.tabs[k], page.counts[k]))}
      </nav>

      <section className="overflow-x-auto rounded-md border bg-surface shadow-card">
        {failed ? (
          <p role="alert" className="p-md text-body text-danger">{c.loadFailed}</p>
        ) : page.items.length === 0 ? (
          <p className="p-md text-body text-fg-secondary">{filtered ? t.emptyFiltered : t.empty}</p>
        ) : (
          <table className="w-full min-w-[52rem] text-start text-body">
            <thead className="border-b text-label text-fg-secondary">
              <tr>
                {[t.col.number, t.col.buyer, t.col.items, t.col.total, t.col.payment, t.col.status, t.col.placed].map((h) => (
                  <th key={h} scope="col" className="p-sm text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((o) => (
                <tr key={o.id} className="border-b align-top last:border-0">
                  <td className="p-sm">
                    <Link href={`/showroom/marketplace/orders/${o.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                      <bdi dir="ltr">{o.order_number}</bdi>
                    </Link>
                    {o.action_needed ? <p className="text-caption font-semibold text-warning">{t.attention}</p> : null}
                  </td>
                  <td className="p-sm">
                    {o.buyer_name}
                    {o.governorate_key ? <p className="text-caption text-fg-secondary">{governorateName(o.governorate_key, locale)}</p> : null}
                  </td>
                  <td className="p-sm">
                    <div className="flex gap-xs">
                      {o.first_items.map((i, k) => (
                        <OrderThumb key={k} imageId={i.image_id} label={itemName(i, locale) || c.imageUnavailable} size={40} />
                      ))}
                    </div>
                    <p className="mt-1 text-caption text-fg-secondary">{c.pieces(o.item_count)}</p>
                  </td>
                  <td className="p-sm tabular-nums">{money(o.total_egp, locale)}</td>
                  <td className="p-sm">
                    <p>{c.method[o.payment_method]}</p>
                    <PaymentBadge status={o.payment_status} locale={locale} />
                  </td>
                  <td className="p-sm"><StatusBadge status={o.status} locale={locale} pickupReady={isReadyForPickup(o.status, o.fulfilment)} /></td>
                  <td className="p-sm text-fg-secondary">{dateOnly(o.placed_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pages > 1 ? (
        <nav aria-label={t.pageOf(query.page, pages)} className="flex items-center justify-between gap-md">
          {query.page > 1 ? <ButtonLink href={sellerOrdersHref({ ...query, page: query.page - 1 })} variant="outline">{t.prev}</ButtonLink> : <span />}
          <span className="text-label text-fg-secondary">{t.pageOf(query.page, pages)}</span>
          {query.page < pages ? <ButtonLink href={sellerOrdersHref({ ...query, page: query.page + 1 })} variant="outline">{t.next}</ButtonLink> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
