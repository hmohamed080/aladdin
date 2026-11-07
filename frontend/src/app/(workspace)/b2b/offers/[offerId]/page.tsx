import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator } from "@/lib/i18n/translate";
import { getPageContext } from "@/server/queries/page-context";
import { getOfferDetail, listRelatedOffers, signOfferImages } from "@/server/queries/offers";
import { StatePanel } from "@/components/ui/primitives";
import { TagIcon } from "@/components/ui/icons";
import { OfferDetailView } from "@/features/offers/offer-detail-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One offer for a business workspace: offer_detail returns it only while this business type may see it. */
export default async function B2BOfferDetailPage({ params }: { params: Promise<{ offerId: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const { offerId } = await params;
  if (!UUID.test(offerId)) notFound();
  const t = createTranslator(locale);

  const offer = await getOfferDetail(supabase, org.organizationId, offerId);
  if (!offer) {
    return (
      <StatePanel
        icon={<TagIcon size={22} />}
        title={t("showroomOffers.detail.notAvailableTitle")}
        body={t("showroomOffers.detail.notAvailableBody")}
        action={<Link href="/b2b/offers" className="text-label font-medium text-accent hover:underline">{t("showroomOffers.detail.back")}</Link>}
      />
    );
  }
  const others = await listRelatedOffers(supabase, org.organizationId, offer.id);
  const imageUrls = await signOfferImages(supabase, org.organizationId, [offer, ...others]);
  const canRfq = org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");
  return (
    <OfferDetailView
      offer={offer}
      imageUrls={imageUrls}
      related={others}
      locale={locale}
      t={t}
      canRfq={canRfq}
      orgId={org.organizationId}
      rfqHref={`/b2b/rfqs/new?product=${offer.items[0]!.productId}`}
      backHref="/b2b/offers"
      feedHref="/b2b/offers"
      detailBase="/b2b/offers"
    />
  );
}
