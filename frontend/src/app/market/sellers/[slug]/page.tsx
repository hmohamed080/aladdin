import { getServerSupabase } from "@/lib/supabase/server";
import { MarketplaceImagesProvider } from "@/features/marketplace/live/image-urls";
import { marketplacePublicImageUrls } from "@/server/media/marketplace-public-images";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ClosedState } from "@/features/marketplace/live/closed-state";
import { SellerStorefront } from "@/features/marketplace/live/seller-storefront";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadPublicCatalogPage, loadPublicOpen, loadPublicSeller } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace showroom | Aladdin",
  robots: { index: false, follow: false },
};

/** Seller storefront: the showroom's name, its Official Store mark and every product it has on the shelf. */
export default async function MarketplaceSellerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (!isMarketplacePreviewEnabled()) redirect("/market");
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const frame = (child: React.ReactNode) => (
    <I18nProvider locale={locale} dir={dir}>
      <MarketplaceShell showTitle={false}>{child}</MarketplaceShell>
    </I18nProvider>
  );
  if (!(await loadPublicOpen())) return frame(<ClosedState locale={locale} />);
  const seller = await loadPublicSeller(slug);
  if (!seller) return frame(<ClosedState locale={locale} kind="seller_missing" />);
  const sp = await searchParams;
  const pageNo = Math.min(10000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const page = await loadPublicCatalogPage({ sort: "newest", page: pageNo, seller: slug });
  const images = await marketplacePublicImageUrls(await getServerSupabase(), (page?.items ?? []).map((item) => item.image_id));
  return frame(
    <MarketplaceImagesProvider images={images}>
      <SellerStorefront locale={locale} seller={seller} page={page} pageNo={pageNo} />
    </MarketplaceImagesProvider>,
  );
}
