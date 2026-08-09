import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listCatalog, type ProductCategory } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { CatalogFilters } from "@/features/commerce/catalog-filters";
import { CatalogGrid } from "@/features/commerce/catalog-grid";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const category = PRODUCT_CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : undefined;

  const products = await listCatalog(supabase, { search: sp.q, category });

  return (
    <div className="pb-16 tablet:pb-0">
      <PageHeader title={m.commerce.catalog.title} subtitle={m.commerce.catalog.subtitle} count={products.length} />
      <CatalogFilters defaults={{ q: sp.q ?? "", category: sp.category ?? "" }} />
      <CatalogGrid products={products} />
    </div>
  );
}
