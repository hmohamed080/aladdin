import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { OfferBuilder, type BuilderInitial } from "@/features/offers/offer-builder";
import { utcToZonedFields } from "@/features/offers/offer-datetime";
import { getOrgTimezone, listPickerProducts } from "@/server/queries/offers";
import { StatePanel } from "@/components/ui/primitives";
import { PackageIcon, TagIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** Create an offer for the ACTIVE organization. Creation starts here (إدارة العروض) and nowhere else. */
export default async function ShowroomNewOfferPage() {
  const { supabase, org } = await requireShowroomContext();
  if (!org.capabilities.includes("catalog.write") && !org.capabilities.includes("org.manage")) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");

  const [products, zone] = await Promise.all([listPickerProducts(supabase, org.organizationId), getOrgTimezone(supabase, org.organizationId)]);
  const now = new Date();
  const start = utcToZonedFields(now.toISOString(), zone);
  const end = utcToZonedFields(new Date(now.getTime() + 14 * 86_400_000).toISOString(), zone);
  const initial: BuilderInitial = {
    offerId: null,
    version: null,
    title: "",
    description: "",
    totalPrice: "",
    referencePrice: "",
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: "23:59",
    items: [],
    audiences: [],
  };

  const hero = (
    <ShowroomPageHero
      locale={locale}
      titleId="new-offer-title"
      Icon={TagIcon}
      title={t("showroomOffers.builder.createTitle")}
      subtitle={t("showroomOffers.builder.subtitle")}
      back={
        <Link href={`${SHOWROOM_ROOT}/my-offers`} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span aria-hidden="true" className="rtl:rotate-180">←</span>
          {t("showroomOffers.builder.back")}
        </Link>
      }
    />
  );

  return (
    <div className="flex flex-col gap-md" data-testid="new-offer">
      {products.length === 0 ? (
        <>
        {hero}
        <StatePanel
          icon={<PackageIcon size={22} />}
          title={t("showroomOffers.mine.noProductsTitle")}
          body={t("showroomOffers.mine.noProductsBody")}
          action={<Link href={`${SHOWROOM_ROOT}/my-products`} className="text-label font-medium text-accent hover:underline">{t("showroomOffers.mine.goProducts")}</Link>}
        />
        </>
      ) : (
        <OfferBuilder orgId={org.organizationId} zone={zone} products={products} initial={initial} readOnly={false} canPublish={canPublish} header={hero} />
      )}
    </div>
  );
}
