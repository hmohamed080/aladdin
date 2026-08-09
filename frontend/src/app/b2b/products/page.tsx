import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOwnProducts } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { ProductsTable } from "@/features/commerce/products-table";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const products = await listOwnProducts(supabase, org.organizationId);

  return (
    <div className="pb-16 tablet:pb-0">
      <PageHeader
        title={m.commerce.products.title}
        subtitle={m.commerce.products.subtitle}
        count={products.length}
        action={canWrite ? { href: "/b2b/products/new", label: m.commerce.products.new } : undefined}
      />
      {!canWrite && products.length === 0 ? (
        <StatePanel title={m.commerce.products.noAccessTitle} body={m.commerce.products.noAccessBody} />
      ) : (
        <ProductsTable products={products} />
      )}
    </div>
  );
}
