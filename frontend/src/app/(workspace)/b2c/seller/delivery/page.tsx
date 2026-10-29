import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { ButtonLink } from "@/components/ui/controls";
import { ChevronLeftIcon, ChevronRightIcon, TruckIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { DeliveryEditor } from "@/features/marketplace-seller/delivery-editor";
import type { StoredRate } from "@/features/marketplace-seller/delivery-model";

export const dynamic = "force-dynamic";

/**
 * /b2c/seller/delivery - what this showroom charges to deliver to each place it covers (the places are
 * chosen on /b2c/seller/areas), and whether buyers may pick up from it. Buyers see these prices in their
 * Marketplace cart. Read and written through the seller RPCs (Migration 12) under the seller's own
 * session; the database re-checks membership, catalogue authority and seller standing on every save.
 */
export default async function MarketplaceDeliveryPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller;
  const { data } = await supabase.rpc("marketplace_seller_delivery_get", { p_organization_id: org.organizationId });
  const settings = (data ?? { rates: [], pickup_available: false }) as unknown as { rates?: StoredRate[]; pickup_available?: boolean };
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={TruckIcon}
        title={t.delivery.title}
        subtitle={t.delivery.subtitle}
        toolbar={
          <ButtonLink href="/b2c/seller/products" variant="outline">
            {locale === "ar" ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
            {t.delivery.back}
          </ButtonLink>
        }
      />
      <DeliveryEditor organizationId={org.organizationId} initialRates={settings.rates ?? []} initialPickup={Boolean(settings.pickup_available)} />
    </div>
  );
}
