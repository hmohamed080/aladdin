import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getProduct } from "@/server/queries/commerce";
import { PageHeader } from "@/components/ui/workspace-layout";
import { BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { ProductForm } from "@/features/commerce/product-form";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { id } = await params;

  const product = await getProduct(supabase, id);
  if (!product || product.organization_id !== org.organizationId) notFound();

  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href={`/b2b/products/${product.id}`}>{product.name}</BackLink>
      <PageHeader title={m.commerce.products.editTitle} />
      {canWrite ? (
        <ProductForm orgId={org.organizationId} product={product} />
      ) : (
        <StatePanel tone="warning" title={m.commerce.products.noAccessTitle} body={m.commerce.products.noAccessBody} />
      )}
    </div>
  );
}
