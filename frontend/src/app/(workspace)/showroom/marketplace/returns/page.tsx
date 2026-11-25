import { PageHeader } from "@/components/ui/workspace-layout";
import { ReceiptIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { RETURN_COPY } from "@/features/marketplace-returns/copy";
import { ReturnList } from "@/features/marketplace-returns/return-view";
import type { SellerReturnsPage } from "@/features/marketplace-returns/contract";

export const dynamic = "force-dynamic";

/** /showroom/marketplace/returns - the return and exchange requests for this showroom (order.manage). */
export default async function SellerReturnsPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const { data } = await supabase.rpc("marketplace_seller_returns_page", { p_organization_id: org.organizationId, p_limit: 100, p_offset: 0 });
  const page = (data ?? { total: 0, counts: {}, items: [] }) as unknown as SellerReturnsPage;
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={ReceiptIcon} title={RETURN_COPY.sellerTitle[locale]} subtitle="" />
      <ReturnList items={page.items} locale={locale} base="/showroom/marketplace/returns" />
    </div>
  );
}
