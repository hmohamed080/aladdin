import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader, BackLink } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { ProductForm } from "@/features/commerce/product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { org, locale } = ctx;
  const m = getMessages(locale);

  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");

  return (
    <div className="pb-16 tablet:pb-0">
      <BackLink href="/b2b/products">{m.commerce.products.title}</BackLink>
      <PageHeader title={m.commerce.products.newTitle} subtitle={m.commerce.products.newSubtitle} />
      {canWrite ? (
        <ProductForm orgId={org.organizationId} />
      ) : (
        <StatePanel tone="warning" title={m.commerce.products.noAccessTitle} body={m.commerce.products.noAccessBody} />
      )}
    </div>
  );
}
