import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { OfferDetailView } from "@/features/offers/offer-detail-view";
import { getOfferDetail, listRelatedOffers, signOfferImages } from "@/server/queries/offers";
import { StatePanel } from "@/components/ui/primitives";
import { TagIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One offer, through `offer_detail`: the database returns it only when THIS workspace is
 * eligible right now (published, in its window, targeted at it, products valid, not its own).
 * Anything else is "not available" — never a hint about why.
 */
export default async function ShowroomOfferDetailPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "offers");
  if (!item || !canNavigate(item, org.capabilities)) notFound();
  const { offerId } = await params;
  if (!UUID.test(offerId)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const offer = await getOfferDetail(supabase, org.organizationId, offerId);
  if (!offer) {
    return (
      <StatePanel
        icon={<TagIcon size={22} />}
        title={t("showroomOffers.detail.notAvailableTitle")}
        body={t("showroomOffers.detail.notAvailableBody")}
        action={<Link href={`${SHOWROOM_ROOT}/offers`} className="text-label font-medium text-accent hover:underline">{t("showroomOffers.detail.back")}</Link>}
      />
    );
  }
  const others = await listRelatedOffers(supabase, org.organizationId, offer.id);
  const imageUrls = await signOfferImages(supabase, org.organizationId, [offer, ...others]);
  const canRfq = org.canManageSales || org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");
  return (
    <OfferDetailView
      offer={offer}
      imageUrls={imageUrls}
      related={others}
      orgId={org.organizationId}
      locale={locale}
      t={t}
      canRfq={canRfq}
      /* Showroom RFQ pages arrive in a later phase; the production request flow is the working one today (same adapter as Browse). */
      rfqHref={`/b2b/rfqs/new?product=${offer.items[0]!.productId}`}
    />
  );
}
