import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { BuyerOrderDetail } from "@/features/marketplace-orders/buyer-order-detail";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { requireUser } from "@/server/auth/session";
import { loadBuyerOrder } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order | Aladdin Marketplace", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One of the buyer's own orders (the RPC answers not_found for anyone else's). Not-found while ordering is off. */
export default async function MarketplaceOrderRoute({ params }: { params: Promise<{ orderId: string }> }) {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) notFound();
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  await requireUser(`/market/orders/${orderId}`);
  const order = await loadBuyerOrder(orderId);
  if (!order) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <BuyerOrderDetail initial={order} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
