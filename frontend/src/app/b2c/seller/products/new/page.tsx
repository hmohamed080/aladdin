import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StorefrontIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ProductForm } from "@/features/marketplace-seller/product-form";
import { loadProductTypeSchemas } from "@/server/queries/marketplace-seller-catalog";

export const dynamic = "force-dynamic";

/** /b2c/seller/products/new — create a Marketplace product as a draft. */
export default async function NewMarketplaceProductPage() {
  const { supabase, org, locale } = await requireApprovedSeller();
  const t = getMessages(locale).marketplaceSeller;
  const schemas = await loadProductTypeSchemas(supabase);
  return (
    <div className="flex flex-col gap-lg">
      <PageHeader locale={locale} Icon={StorefrontIcon} title={t.newTitle} subtitle={t.newSubtitle} />
      <ProductForm organizationId={org.organizationId} schemas={schemas} />
    </div>
  );
}
