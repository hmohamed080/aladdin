import { getServerSupabase } from "@/lib/supabase/server";
import { MarketplaceImagesProvider } from "@/features/marketplace/live/image-urls";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ClosedState } from "@/features/marketplace/live/closed-state";
import { placeFromParams } from "@/features/marketplace/live/delivery-model";
import { LiveProduct } from "@/features/marketplace/live/live-product";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadPublicDelivery, loadPublicOpen, loadPublicProduct } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace product | Aladdin",
  robots: { index: false, follow: false },
};

/**
 * Live product page. A draft, unpublished, archived, suspended-seller or out-of-stock product is a plain 404; while the
 * platform team has the Marketplace closed the page shows the closed state. The buyer's place for the delivery block
 * comes from `?gov=&area=`.
 */
export default async function MarketplaceProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  // Closed release flag: every deep link lands on the "coming soon" page.
  if (!isMarketplacePreviewEnabled()) redirect("/market");
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  if (!(await loadPublicOpen())) {
    return (
      <I18nProvider locale={locale} dir={dir}>
        <MarketplaceShell showTitle={false}>
          <ClosedState locale={locale} />
        </MarketplaceShell>
      </I18nProvider>
    );
  }
  const sp = await searchParams;
  const place = placeFromParams(sp.gov, sp.area);
  const [product, terms] = await Promise.all([loadPublicProduct(slug), loadPublicDelivery(slug, place)]);
  if (!product) notFound();
  const images = await marketplacePublicImageUrls(await getServerSupabase(), product.images.map((image) => image.image_id));
  return (
    <I18nProvider locale={locale} dir={dir}>
      <MarketplaceShell showTitle={false}>
        <MarketplaceImagesProvider images={images}>
          <LiveProduct product={product} terms={terms} place={place} />
        </MarketplaceImagesProvider>
      </MarketplaceShell>
    </I18nProvider>
  );
}
