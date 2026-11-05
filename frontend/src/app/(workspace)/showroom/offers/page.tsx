import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { OffersFeedView } from "@/features/offers/offers-feed-view";
import { listOffersPage, signOfferImages } from "@/server/queries/offers";
import { TagIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * العروض — the audience Offers feed. Account-agnostic: the database decides which offers THIS
 * workspace may see (published, inside its window, targeted at its business type, products
 * still valid, not its own); this page only presents them.
 */
export default async function ShowroomOffersPage() {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "offers");
  if (!item || !canNavigate(item, org.capabilities)) notFound();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const page = await listOffersPage(supabase, org.organizationId);
  const imageUrls = await signOfferImages(supabase, org.organizationId, page.items);
  return (
    <div className="flex flex-col gap-md" data-testid="showroom-offers">
      <ShowroomPageHero locale={locale} titleId="offers-title" Icon={TagIcon} title={t("showroomOffers.feed.title")} subtitle={t("showroomOffers.feed.subtitle")} />
      <OffersFeedView initialPage={page} initialImageUrls={imageUrls} orgId={org.organizationId} locale={locale} initialView={resolveCatalogView(store.get(CATALOG_VIEW_COOKIE)?.value)} />
    </div>
  );
}
