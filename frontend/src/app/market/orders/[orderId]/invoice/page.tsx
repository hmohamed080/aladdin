import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { InvoiceView } from "@/features/marketplace-orders/print-views";
import { ordersCopy } from "@/features/marketplace-orders/orders-copy";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";
import { loadOrderInvoice } from "@/server/queries/marketplace-orders-v2";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice | Aladdin Marketplace", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The buyer's order invoice (issued on the first read once the order is ready). Not a tax invoice. */
export default async function MarketplaceBuyerInvoiceRoute({ params }: { params: Promise<{ orderId: string }> }) {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) notFound();
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  await requireUser(`/market/orders/${orderId}/invoice`);
  const invoice = await loadOrderInvoice(await getServerSupabase(), orderId);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        {invoice ? (
          <InvoiceView invoice={invoice} backHref={`/market/orders/${orderId}`} />
        ) : (
          <p role="status" className="py-lg text-center text-body text-fg-secondary">{ordersCopy[locale].invoice.unavailable}</p>
        )}
      </MarketplaceShell>
    </I18nProvider>
  );
}
