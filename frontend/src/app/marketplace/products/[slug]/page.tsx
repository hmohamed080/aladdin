import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LiveProduct } from "@/features/marketplace/live/live-product";
import { MarketplaceShell } from "@/features/marketplace/marketplace-shell";
import { isMarketplacePreviewEnabled } from "@/lib/env";
import { LOCALE_COOKIE, directionFor, resolveLocale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/provider";
import { loadPublicProduct } from "@/server/queries/marketplace-public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace product | Aladdin",
  robots: { index: false, follow: false },
};

/** Live product page. A draft, unpublished, archived or suspended-seller product is a plain 404. */
export default async function MarketplaceProductPage({ params }: { params: Promise<{ slug: string }> }) {
  // Closed Marketplace: every deep link lands on the "coming soon" page.
  if (!isMarketplacePreviewEnabled()) redirect("/marketplace");
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) notFound();
  const product = await loadPublicProduct(slug);
  if (!product) notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <I18nProvider locale={locale} dir={directionFor(locale)}>
      <MarketplaceShell live showTitle={false}>
        <LiveProduct product={product} />
      </MarketplaceShell>
    </I18nProvider>
  );
}
