import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LiveCartPage } from "@/features/marketplace/live/live-cart-page";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { readPublicEnv } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadPublicCatalogPage } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cart | Aladdin Marketplace",
  robots: { index: false, follow: false },
};

/**
 * The guest cart of the live Marketplace. What is in the cart lives in the visitor's browser; the
 * page asks the database for current prices, availability and each showroom's delivery fee (a
 * read-only server action), and checkout stays closed ("coming soon"). Behind the same flag as the
 * rest of the Marketplace, so it is a plain 404 wherever the Marketplace is not open.
 */
export default async function MarketplaceCartRoute() {
  if (readPublicEnv().NEXT_PUBLIC_MARKETPLACE_PREVIEW !== "true") notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // a few newest published products for the "you may also like" shelf (already-in-cart ones are hidden client-side)
  const page = await loadPublicCatalogPage({ sort: "newest", page: 1 });
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell live showTitle={false}>
        <LiveCartPage suggestions={(page?.items ?? []).slice(0, 12)} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
