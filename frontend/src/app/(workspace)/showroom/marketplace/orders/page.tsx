import Link from "next/link";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ReceiptIcon } from "@/components/ui/icons";
import { formatEgp } from "@/lib/ui/egp-format";
import { cn } from "@/lib/ui/cn";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ORDER_STATUSES, type OrderStatus, type SellerOrdersPage } from "@/features/marketplace-orders/contract";

export const dynamic = "force-dynamic";

/**
 * /showroom/marketplace/orders - the orders Marketplace buyers placed with this showroom, filtered by
 * status. Read through marketplace_seller_orders_page (Migration 14), which admits only members who
 * may manage orders (order.manage or org.manage).
 */
export default async function MarketplaceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller.orders;
  const q = await searchParams;
  const status = typeof q.status === "string" && (ORDER_STATUSES as readonly string[]).includes(q.status) ? (q.status as OrderStatus) : null;
  const { data } = await supabase.rpc("marketplace_seller_orders_page", {
    p_organization_id: org.organizationId,
    p_status: status ?? undefined,
    p_limit: 100,
    p_offset: 0,
  });
  const page = (data ?? { total: 0, counts: {}, awaiting_review: 0, items: [] }) as unknown as SellerOrdersPage;
  const all = Object.values(page.counts).reduce((n, v) => n + Number(v ?? 0), 0);
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(new Date(iso));
  const tab = (key: OrderStatus | null, label: string, count: number) => (
    <Link
      key={key ?? "all"}
      href={key ? `/showroom/marketplace/orders?status=${key}` : "/showroom/marketplace/orders"}
      aria-current={status === key ? "page" : undefined}
      className={cn(
        "rounded-full border px-sm py-1 text-label",
        status === key ? "border-accent bg-accent/10 font-semibold text-fg" : "text-fg-secondary hover:text-fg",
      )}
    >
      {label} <span className="tabular-nums">({count})</span>
    </Link>
  );

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={ReceiptIcon} title={t.title} subtitle={t.subtitle} />
      {page.awaiting_review > 0 ? (
        <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 p-sm text-label text-fg">
          {t.awaitingReview.replace("{n}", String(page.awaiting_review))}
        </p>
      ) : null}
      <nav className="flex flex-wrap gap-sm" aria-label={t.col.status}>
        {tab(null, t.all, all)}
        {ORDER_STATUSES.filter((s) => (page.counts[s] ?? 0) > 0 || s === status).map((s) => tab(s, t.status[s], Number(page.counts[s] ?? 0)))}
      </nav>
      <section className="overflow-x-auto rounded-md border bg-surface shadow-card">
        {page.items.length === 0 ? (
          <p className="p-md text-body text-fg-secondary">{t.empty}</p>
        ) : (
          <table className="w-full min-w-[44rem] text-start text-body">
            <thead className="border-b text-label text-fg-secondary">
              <tr>
                {[t.col.number, t.col.buyer, t.col.items, t.col.total, t.col.payment, t.col.status, t.col.placed].map((h) => (
                  <th key={h} scope="col" className="p-sm text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((o) => (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="p-sm">
                    <Link href={`/showroom/marketplace/orders/${o.id}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                      <bdi dir="ltr">{o.order_number}</bdi>
                    </Link>
                  </td>
                  <td className="p-sm">{o.buyer_name}</td>
                  <td className="p-sm tabular-nums">{t.itemsCount.replace("{n}", String(o.item_count))}</td>
                  <td className="p-sm tabular-nums">{formatEgp(Number(o.total_egp), locale)}</td>
                  <td className="p-sm">
                    {t.method[o.payment_method]}
                    <br />
                    <span className={cn("text-caption", o.payment_status === "deposit_submitted" ? "font-semibold text-warning" : "text-fg-secondary")}>
                      {t.payment[o.payment_status]}
                    </span>
                  </td>
                  <td className="p-sm">{t.status[o.status]}</td>
                  <td className="p-sm text-fg-secondary">{date(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
