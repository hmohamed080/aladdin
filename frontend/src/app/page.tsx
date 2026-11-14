import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nMessagesProvider } from "@/lib/i18n/context";
import { LandingHero } from "@/features/landing-preview/landing-hero";
import { LandingEcosystem } from "@/features/landing-preview/landing-ecosystem";
import { LandingMarketplaceSection } from "@/features/landing-marketplace/landing-marketplace-section";
import { LandingMotion } from "@/features/landing-preview/landing-motion";
import { landingMessages } from "@/features/landing-preview/landing-messages";
import { MarketplaceImagesProvider } from "@/features/marketplace/live/image-urls";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";
import { loadPublicCatalogPage } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

/**
 * App entry — THE public Aladdin Landing Page, and the only one `/` ever renders.
 *
 * The approved composition is `LandingMotion` > `LandingHero` + `LandingEcosystem`
 * (header, hero, process, roles, videos, brands, stories, final call to action and
 * footer all live inside those). It is deliberately NOT chosen by environment: a
 * preview, Production, staging and a plain branch deployment must all serve
 * the same page. `NEXT_PUBLIC_APP_ENV` used to select between this and the older
 * `landing-v2` stack, which let the old page come back on any deployment that did
 * not set it to "staging"; that split is gone. The `landing-v2` components stay in
 * the repo as reference only and are no longer mounted anywhere.
 */
export default async function RootPage() {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  // While the Marketplace is open (release flag), the header shows the cart and the Marketplace section
  // shows the newest real products with a working "Add to cart". Closed: the sample preview, no cart.
  const marketplaceOpen = isMarketplacePreviewEnabled();
  const live = marketplaceOpen ? ((await loadPublicCatalogPage({ sort: "newest", page: 1 }))?.items ?? []).slice(0, 8) : [];
  const images = live.length > 0 ? await marketplacePublicImageUrls(await getServerSupabase(), live.map((item) => item.image_id)) : {};

  return (
    <I18nMessagesProvider
      locale={locale}
      dir={directionFor(locale)}
      messages={landingMessages(locale)}
    >
      <LandingMotion>
        <LandingHero showCart={marketplaceOpen} />
        <LandingEcosystem
          marketplaceSlot={
            <MarketplaceImagesProvider images={images}>
              <LandingMarketplaceSection live={live} />
            </MarketplaceImagesProvider>
          }
        />
      </LandingMotion>
    </I18nMessagesProvider>
  );
}
