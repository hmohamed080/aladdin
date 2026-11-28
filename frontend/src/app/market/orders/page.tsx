import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { BuyerOrdersList } from "@/features/marketplace-orders/buyer-orders-list";
import { parseBuyerOrdersQuery } from "@/features/marketplace-orders/order-model";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { requireUser } from "@/server/auth/session";
import { loadBuyerOrders } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My orders | Aladdin Marketplace", robots: { index: false, follow: false } };

/** The signed-in buyer's Marketplace orders (Noon "Orders" layout): search, period, status group. Hidden while ordering is off. */
export default async function MarketplaceOrdersRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) redirect("/market");
  await requireUser("/market/orders");
  const query = parseBuyerOrdersQuery(await searchParams);
  const page = await loadBuyerOrders(query);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <BuyerOrdersList page={page} query={query} failed={page.failed} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
