import { cookies } from "next/headers";
import { createTranslator } from "@/lib/i18n/translate";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { getPageContext } from "@/server/queries/page-context";
import { listOffersPage, signOfferImages } from "@/server/queries/offers";
import { PageHeader } from "@/components/ui/workspace-layout";
import { TagIcon } from "@/components/ui/icons";
import { OffersFeedView } from "@/features/offers/offers-feed-view";

export const dynamic = "force-dynamic";

/**
 * العروض — the shared audience Offers feed for every business workspace (showroom, supplier,
 * manufacturer, importer, contractor company, design office). A thin adapter: the
 * database decides which offers this business type may see; the feed itself is features/offers.
 */
export default async function B2BOffersPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const t = createTranslator(locale);
  const store = await cookies();
  const page = await listOffersPage(supabase, org.organizationId);
  const imageUrls = await signOfferImages(supabase, org.organizationId, page.items);
  return (
    <div className="flex flex-col gap-md pb-16 tablet:pb-0" data-testid="b2b-offers">
      <PageHeader locale={locale} Icon={TagIcon} title={t("showroomOffers.feed.title")} subtitle={t("showroomOffers.feed.subtitle")} />
      <OffersFeedView
        initialPage={page}
        initialImageUrls={imageUrls}
        orgId={org.organizationId}
        locale={locale}
        initialView={resolveCatalogView(store.get(CATALOG_VIEW_COOKIE)?.value)}
        detailBase="/b2b/offers"
      />
    </div>
  );
}
