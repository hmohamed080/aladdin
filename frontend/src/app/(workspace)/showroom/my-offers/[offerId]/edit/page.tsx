import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { OfferBuilder, type BuilderInitial } from "@/features/offers/offer-builder";
import { utcToZonedFields } from "@/features/offers/offer-datetime";
import { getOrgTimezone, getOwnOffer, listPickerProducts } from "@/server/queries/offers";
import { TagIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_KEY = /^showroomOffers\.errors\.[A-Za-z]+$/;

/**
 * Edit (or, when the offer's state forbids it, just inspect) one of THIS organization's offers.
 * Another tenant's offer id is simply not found here: the query is owner-scoped by RLS and by org.
 */
export default async function ShowroomEditOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ saved?: string; err?: string }>;
}) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "my-offers");
  if (!item || !canNavigate(item, org.capabilities)) notFound();
  const { offerId } = await params;
  if (!UUID.test(offerId)) notFound();
  const sp = await searchParams;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);

  const offer = await getOwnOffer(supabase, org.organizationId, offerId);
  if (!offer) notFound();
  const [products, zone] = await Promise.all([listPickerProducts(supabase, org.organizationId), getOrgTimezone(supabase, org.organizationId)]);

  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  // Draft and paused offers are editable; a scheduled one too (nobody sees it yet), but changing a published offer is a publishing decision.
  const editable = offer.phase === "draft" || offer.phase === "paused" || (offer.phase === "scheduled" && canPublish);
  const start = utcToZonedFields(offer.startsAt, zone);
  const end = utcToZonedFields(offer.endsAt, zone);
  const known = new Set(products.map((p) => p.id));
  const initial: BuilderInitial = {
    offerId: offer.id,
    version: offer.version,
    title: offer.title,
    description: offer.description ?? "",
    totalPrice: String(offer.totalPrice),
    referencePrice: offer.referencePrice === null ? "" : String(offer.referencePrice),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    items: offer.items.filter((i) => known.has(i.productId)).map((i) => ({ productId: i.productId, quantity: i.quantity })),
    audiences: offer.audiences,
  };
  const errorKey = sp.err && SAFE_ERROR_KEY.test(sp.err) ? sp.err : null;

  const header = (
    <>
      <ShowroomPageHero
          locale={locale}
          titleId="edit-offer-title"
          Icon={TagIcon}
          title={t("showroomOffers.builder.editTitle")}
          subtitle={offer.title}
          back={
            <Link href={`${SHOWROOM_ROOT}/my-offers`} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <span aria-hidden="true" className="rtl:rotate-180">←</span>
              {t("showroomOffers.builder.back")}
            </Link>
          }
        />
      {sp.saved === "1" && !errorKey ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="offer-saved-note">{t("showroomOffers.mine.saved")}</p> : null}
    </>
  );

  return (
    <div className="flex flex-col gap-md" data-testid="edit-offer" data-phase={offer.phase}>
      <OfferBuilder orgId={org.organizationId} zone={zone} products={products} initial={initial} readOnly={!canWrite || !editable} errorKey={errorKey} canPublish={canPublish} header={header} />
    </div>
  );
}
