import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { LiveCheckoutPage } from "@/features/marketplace-orders/live-checkout-page";
import { buyerCopy } from "@/features/marketplace-orders/buyer-copy";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout | Aladdin Marketplace",
  robots: { index: false, follow: false },
};

const KEY = /^[a-z0-9-]{1,40}$/;

/**
 * Checkout of the live Marketplace. The cart lives in the browser; placing an order needs a signed-in
 * buyer, so a visitor sees a sign-in panel (the cart stays on the device). The governorate and area
 * chosen in the cart come along in the query string as a starting point only.
 */
export default async function MarketplaceCheckoutRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isMarketplacePreviewEnabled()) redirect("/marketplace");
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const c = buyerCopy[locale];
  const user = await getCurrentUser();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && KEY.test(v) ? v : "");
  const gov = one(q.gov);
  const area = gov ? one(q.area) : "";
  const next = encodeURIComponent("/marketplace/checkout");

  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        {user ? (
          <LiveCheckoutPage
            initial={{
              name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.slice(0, 100) : "",
              phone: user.phone ? `+${user.phone.replace(/^\+/, "")}` : "",
              governorate: gov,
              area,
            }}
          />
        ) : (
          <div className={styles.page}>
            <section className={styles.empty}>
              <h2 data-plain>{c.signInTitle}</h2>
              <p>{c.signInText}</p>
              <Link href={`/auth/sign-in?next=${next}`} className={styles.primary}>{c.signIn}</Link>
              <Link href={`/auth/sign-up?next=${next}`} className={styles.secondary}>{c.signUp}</Link>
              <Link href="/marketplace/cart" className={styles.secondary}>{c.backToCart}</Link>
            </section>
          </div>
        )}
      </MarketplaceShell>
    </I18nProvider>
  );
}
