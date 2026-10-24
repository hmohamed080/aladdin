import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { ShowroomPageHero } from "@/features/showroom-shell/page-hero";
import { MyOffersView } from "@/features/offers/my-offers-view";
import { loadMyOffersBatch } from "@/features/offers/my-offers-data";
import { DEFAULT_MY_OFFERS_PARAMS } from "@/features/offers/offer-model";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import { TagIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** إدارة العروض — the offers owned by the ACTIVE organization (drafts and archived included), through owner-only RLS. */
export default async function ShowroomMyOffersPage({ searchParams }: { searchParams: Promise<{ saved?: string; published?: string }> }) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "my-offers");
  if (!item || !canNavigate(item, org.capabilities)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const sp = await searchParams;
  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  // First batch only (default filters); the summary counts cover the whole history.
  const batch = await loadMyOffersBatch(supabase, org.organizationId, DEFAULT_MY_OFFERS_PARAMS, 0, PAGE_BATCH);
  const notice = sp.published === "1" ? t("showroomOffers.mine.published") : sp.saved === "1" ? t("showroomOffers.mine.saved") : null;
  return (
    <div className="flex flex-col gap-md" data-testid="showroom-my-offers">
      <ShowroomPageHero
        locale={locale}
        titleId="my-offers-title"
        Icon={TagIcon}
        title={t("showroomOffers.mine.title")}
        subtitle={t("showroomOffers.mine.subtitle")}
        action={
          canWrite ? (
            <Link
              href={`${SHOWROOM_ROOT}/my-offers/new`}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-sm bg-accent-solid ring-1 ring-accent-edge px-lg text-label font-semibold text-on-accent shadow-sm hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              data-testid="create-offer"
            >
              <TagIcon size={18} />
              <span>{t("showroomOffers.mine.create")}</span>
            </Link>
          ) : undefined
        }
      />
      <MyOffersView offers={batch.offers} total={batch.total} counts={batch.counts} locale={locale} canWrite={canWrite} canPublish={canPublish} notice={notice} />
    </div>
  );
}
