import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { ReturnRequest } from "@/features/marketplace-returns/return-request";
import { RETURN_REQUEST_COPY } from "@/features/marketplace-returns/copy";
import type { Eligibility } from "@/features/marketplace-returns/contract";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New return | Aladdin Marketplace", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `/market/returns/new?order=<id>&kind=return|exchange` - the buyer's request for one delivered order of their own. */
export default async function NewReturnRoute({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) redirect("/market");
  const sp = await searchParams;
  const orderId = sp.order ?? "";
  if (!UUID.test(orderId)) notFound();
  const kind = sp.kind === "exchange" ? "exchange" : "return";
  await requireUser(`/market/returns/new?order=${orderId}&kind=${kind}`);
  const supabase = await getServerSupabase();
  const { data } = await supabase.rpc("marketplace_buyer_return_eligibility", { p_order_id: orderId });
  if (!data) notFound(); // not the caller's order
  const eligibility = data as unknown as Eligibility;
  if (eligibility.active_return_id) redirect(`/market/returns/${eligibility.active_return_id}`);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const c = RETURN_REQUEST_COPY[locale];
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <div className={styles.page}>
          <header className={styles.head}>
            <div>
              <h1 data-plain>{c.title}</h1>
            </div>
          </header>
          {eligibility.eligible ? (
            <div className={styles.main}>
              <ReturnRequest orderId={orderId} eligibility={eligibility} initialKind={kind} locale={locale} now={new Date().toISOString()} />
            </div>
          ) : (
            <section className={styles.empty}>
              <p>{c.unavailable}</p>
              <Link href={`/market/orders/${orderId}`} className={styles.secondary}>{c.back}</Link>
            </section>
          )}
        </div>
      </MarketplaceShell>
    </I18nProvider>
  );
}
