import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ButtonLink } from "@/components/ui/controls";
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { AreasEditor } from "@/features/marketplace-seller/areas-editor";
import { unpricedCount, type StoredRate } from "@/features/marketplace-seller/delivery-model";

export const dynamic = "force-dynamic";

/**
 * /b2c/seller/areas - WHERE this showroom delivers: whole governorates and/or single areas. Prices are
 * set per place on /b2c/seller/delivery. Read and written through the seller RPCs (Migration 12) under the
 * seller's own session; the database re-checks membership, catalogue authority and seller standing on save.
 */
export default async function MarketplaceAreasPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller.areas;
  const { data } = await supabase.rpc("marketplace_seller_delivery_get", { p_organization_id: org.organizationId });
  const rates = ((data as unknown as { rates?: StoredRate[] } | null)?.rates ?? []) as StoredRate[];
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={MapPinIcon}
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ButtonLink href="/b2c/seller/delivery" variant="outline">
            {locale === "ar" ? <ChevronLeftIcon size={16} /> : <ChevronRightIcon size={16} />}
            {t.setPrices}
          </ButtonLink>
        }
      />
      <AreasEditor organizationId={org.organizationId} initialRates={rates} unpriced={unpricedCount(rates)} />
    </div>
  );
}
