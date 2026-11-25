import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { ReturnDetail } from "@/features/marketplace-returns/return-view";
import type { ReturnDocument } from "@/features/marketplace-returns/contract";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Return | Aladdin Marketplace", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function BuyerReturnRoute({ params }: { params: Promise<{ id: string }> }) {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) redirect("/market");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await requireUser(`/market/returns/${id}`);
  const supabase = await getServerSupabase();
  const { data } = await supabase.rpc("marketplace_buyer_return_get", { p_return_id: id });
  if (!data) notFound();
  const doc = ((data as { return?: ReturnDocument }).return ?? data) as ReturnDocument;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <div className={styles.page}>
          <ReturnDetail doc={doc} role="buyer" locale={locale} />
        </div>
      </MarketplaceShell>
    </I18nProvider>
  );
}
