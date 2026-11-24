import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { CheckoutPage } from "@/features/marketplace-checkout/checkout-page";
import { buyerCopy } from "@/features/marketplace-orders/buyer-copy";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getCurrentUser } from "@/server/auth/session";
import { loadBuyerAddresses } from "@/server/queries/marketplace-addresses";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout | Aladdin Marketplace",
  robots: { index: false, follow: false },
};

/**
 * Checkout of the live Marketplace. The cart lives in the browser; placing an order needs a signed-in
 * buyer, so a visitor sees a sign-in panel (the cart stays on the device).
 */
export default async function MarketplaceCheckoutRoute() {
  if (!isMarketplacePreviewEnabled()) redirect("/market");
  if (!isMarketplaceOrderingEnabled()) redirect("/market");
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const c = buyerCopy[locale];
  const user = await getCurrentUser();
  const addressState = user ? await loadBuyerAddresses() : null;
  const next = encodeURIComponent("/market/checkout");

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        {user ? (
          <CheckoutPage
            addresses={addressState?.addresses ?? []}
            userName={typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim().split(/\s+/)[0]?.slice(0, 40) ?? "" : ""}
          />
        ) : (
          <div className={styles.page}>
            <section className={styles.empty}>
              <h2 data-plain>{c.signInTitle}</h2>
              <p>{c.signInText}</p>
              <Link href={`/auth/sign-in?next=${next}`} className={styles.primary}>{c.signIn}</Link>
              <Link href={`/auth/sign-up?next=${next}`} className={styles.secondary}>{c.signUp}</Link>
              <Link href="/market/cart" className={styles.secondary}>{c.backToCart}</Link>
            </section>
          </div>
        )}
      </MarketplaceShell>
    </I18nProvider>
  );
}
