import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { ConfirmedView } from "@/features/marketplace-checkout/confirmed-view";
import type { OrderDocument } from "@/features/marketplace-orders/contract";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thank you | Aladdin Marketplace", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Thank-you page after a confirmed checkout. Reads the buyer's own order (the RPC answers not_found for anyone else's). */
export default async function MarketplaceCheckoutConfirmedRoute({ params }: { params: Promise<{ orderId: string }> }) {
  if (!isMarketplacePreviewEnabled()) redirect("/market");
  if (!isMarketplaceOrderingEnabled()) redirect("/market");
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  await requireUser(`/market/checkout/confirmed/${orderId}`);
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_order_get", { p_order_id: orderId });
  if (error || !data) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <ConfirmedView order={data as unknown as OrderDocument} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
