import { notFound } from "next/navigation";
import { ReceiptIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/workspace-layout";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { RETURN_POLICY_COPY } from "@/features/marketplace-returns/copy";
import { ReturnPolicyForm } from "@/features/marketplace-returns/return-policy-form";
import type { ReturnSettings } from "@/features/marketplace-returns/contract";

export const dynamic = "force-dynamic";

/** /showroom/marketplace/return-policy - the showroom's return windows (read and saved by the seller RPCs, order.manage). */
export default async function SellerReturnPolicyRoute() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const { data, error } = await supabase.rpc("marketplace_seller_return_settings_get", { p_organization_id: org.organizationId });
  if (error || !data) notFound();
  const c = RETURN_POLICY_COPY[locale];
  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={ReceiptIcon} title={c.title} subtitle={c.subtitle} />
      <ReturnPolicyForm organizationId={org.organizationId} initial={data as unknown as ReturnSettings} locale={locale} />
    </div>
  );
}
