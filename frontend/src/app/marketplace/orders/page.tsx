import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ReceiptIcon } from "@/components/ui/icons";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { buyerCopy } from "@/features/marketplace-orders/buyer-copy";
import type { OrderSummary } from "@/features/marketplace-orders/contract";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My orders | Aladdin Marketplace", robots: { index: false, follow: false } };

/** The signed-in buyer's Marketplace orders, newest first. */
export default async function MarketplaceOrdersRoute() {
  if (!isMarketplacePreviewEnabled()) redirect("/marketplace");
  await requireUser("/marketplace/orders");
  const supabase = await getServerSupabase();
  const { data } = await supabase.rpc("marketplace_buyer_orders", { p_limit: 100, p_offset: 0 });
  const items = ((data as { items?: OrderSummary[] } | null)?.items ?? []) as OrderSummary[];
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const c = buyerCopy[locale];
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(new Date(iso));

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <div className={styles.page}>
          <header className={styles.head}>
            <ReceiptIcon size={40} aria-hidden="true" />
            <div>
              <h1 data-plain>{c.ordersTitle}</h1>
              <p>{c.ordersSubtitle}</p>
            </div>
          </header>
          {items.length === 0 ? (
            <section className={styles.empty}>
              <p>{c.ordersEmpty}</p>
              <Link href="/marketplace" className={styles.primary}>{c.continueShopping}</Link>
            </section>
          ) : (
            <section className={styles.card}>
              <ul className={styles.sellerFees}>
                {items.map((o) => (
                  <li key={o.id}>
                    <span>
                      <Link href={`/marketplace/orders/${o.id}`}><bdi dir="ltr">{o.order_number}</bdi></Link>
                      {" · "}{o.seller_name}{" · "}{c.pieces(o.item_count)}{" · "}{date(o.created_at)}
                      <br />
                      <small className={styles.muted}>{c.status[o.status]} · {c.paymentStatus[o.payment_status]}</small>
                    </span>
                    <strong>{fmtEgp(Number(o.total_egp), locale)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </MarketplaceShell>
    </I18nProvider>
  );
}
