import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { RETURN_COPY } from "@/features/marketplace-returns/copy";
import { ReturnList } from "@/features/marketplace-returns/return-view";
import type { ReturnSummary } from "@/features/marketplace-returns/contract";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My returns | Aladdin Marketplace", robots: { index: false, follow: false } };

/** The signed-in buyer's return and exchange requests. Hidden behind the ordering flag. */
export default async function BuyerReturnsRoute() {
  if (!isMarketplacePreviewEnabled() || !isMarketplaceOrderingEnabled()) redirect("/market");
  await requireUser("/market/returns");
  const supabase = await getServerSupabase();
  const { data } = await supabase.rpc("marketplace_buyer_returns", { p_limit: 100, p_offset: 0 });
  const items = ((data as { items?: ReturnSummary[] } | null)?.items ?? []) as ReturnSummary[];
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <div className={styles.page}>
          <h1 data-plain>{RETURN_COPY.buyerTitle[locale]}</h1>
          <ReturnList items={items} locale={locale} base="/market/returns" />
        </div>
      </MarketplaceShell>
    </I18nProvider>
  );
}
