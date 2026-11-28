import { I18nMessagesProvider } from "@/lib/i18n/context";
import { LandingBrand } from "@/features/landing-brand/landing-brand";
import { readLandingStats } from "@/features/landing-brand/landing-brand-stats.server";
import { landingMessages } from "@/features/landing-preview/landing-messages";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSessionIdentity } from "@/server/auth/session";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";
import { loadPublicCatalogPage } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

/**
 * App entry — THE public Aladdin Landing Page, and the only one `/` ever renders.
 *
 * Brand-identity composition (design-system v1.1.0): `LandingBrand` — header, hero with live platform counts, roles,
 * services, product market preview, how it works, why Aladdin, experience, partners, FAQ, final call to action and
 * footer. It is deliberately NOT chosen by environment: a preview, Production, staging and a plain branch deployment
 * must all serve the same page. The earlier `landing-preview` (LandingMotion > LandingHero + LandingEcosystem) and
 * `landing-v2` components stay in the repo as reference only and are no longer mounted anywhere.
 */
export default async function RootPage() {
  // The landing page is Arabic-only: no language switch, no locale cookie lookup. The session is read only so the header
  // offers sign-in to guests alone (the anonymous edge cache skips every request that carries a cookie).
  // While the Marketplace is open (release flag) the header shows the cart and the product section shows the newest
  // real products with a working "Add to cart". Closed: the sample cards and no cart, and nothing is read.
  const open = isMarketplacePreviewEnabled();
  const live = open ? ((await loadPublicCatalogPage({ sort: "newest", page: 1 }))?.items ?? []).slice(0, 8) : [];
  const images = live.length > 0 ? await marketplacePublicImageUrls(await getServerSupabase(), live.map((item) => item.image_id)) : {};
  return (
    <I18nMessagesProvider locale="ar" dir="rtl" messages={landingMessages("ar")}>
      <LandingBrand stats={await readLandingStats()} market={{ open, live, images }} signedIn={(await getSessionIdentity()) !== null} />
    </I18nMessagesProvider>
  );
}
