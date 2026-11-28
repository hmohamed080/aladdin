import { getServerSupabase } from "@/lib/supabase/server";
import { MarketplaceImagesProvider } from "@/features/marketplace/live/image-urls";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LiveCartPage } from "@/features/marketplace/live/live-cart-page";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { isMarketplaceOrderingEnabled, isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadBuyerAddresses } from "@/server/queries/marketplace-addresses";
import { loadPublicCatalogPage } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cart | Aladdin Marketplace",
  robots: { index: false, follow: false },
};

/**
 * The cart of the live Marketplace. What is in the cart lives in the browser; the page asks the
 * database for current prices, availability and each showroom's delivery fee (a read-only server
 * action) and leads to `/market/checkout`. Behind the same two flags as ordering, so it redirects
 * to `/market` wherever ordering is not open.
 */
export default async function MarketplaceCartRoute() {
  // Closed Marketplace: every deep link lands on the "coming soon" page.
  if (!isMarketplacePreviewEnabled()) redirect("/market");
  // Browse-only launch: no cart until ordering is switched on (NEXT_PUBLIC_MARKETPLACE_ORDERING = "true").
  if (!isMarketplaceOrderingEnabled()) redirect("/market");
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // a few newest published products for the "you may also like" shelf (already-in-cart ones are hidden client-side)
  const page = await loadPublicCatalogPage({ sort: "newest", page: 1 });
  const suggestions = (page?.items ?? []).slice(0, 12);
  const supabase = await getServerSupabase();
  const images = await marketplacePublicImageUrls(supabase, suggestions.map((item) => item.image_id));
  // the signed-in buyer's own saved addresses, so the cart prices delivery without asking again
  const { data: auth } = await supabase.auth.getUser();
  const saved = auth.user ? await loadBuyerAddresses() : null;
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell showTitle={false}>
        <MarketplaceImagesProvider images={images}>
          <LiveCartPage suggestions={suggestions} addresses={saved?.addresses} />
        </MarketplaceImagesProvider>
      </MarketplaceShell>
    </I18nProvider>
  );
}
