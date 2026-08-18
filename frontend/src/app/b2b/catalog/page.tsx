import { getPageContext } from "@/server/queries/page-context";
import { SearchIcon } from "@/components/ui/icons";
import { getMessages } from "@/lib/i18n/translate";
import { listCatalog, savedProductIds, type ProductCategory } from "@/server/queries/commerce";
import { PageHeader } from "@/components/ui/workspace-layout";
import { FilterBar } from "@/components/ui/filter-bar";
import { CatalogGrid } from "@/features/commerce/catalog-grid";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";

export const dynamic = "force-dynamic";

/**
 * Browse Products — the cross-tenant published catalog.
 *
 * `supplier` narrows to one business, which is how the Suppliers directory hands
 * off: "show me what this supplier sells". RLS still decides what is visible; the
 * filter can only narrow that set.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; supplier?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const category = PRODUCT_CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : undefined;

  const [products, saved] = await Promise.all([
    listCatalog(supabase, { search: sp.q, category, supplierOrgId: sp.supplier }),
    savedProductIds(supabase, org.organizationId),
  ]);

  // When the list is scoped to one supplier, say whose catalog this is.
  const supplierName = sp.supplier ? (products[0]?.supplier_name ?? null) : null;

  return (
    <div className="pb-16 tablet:pb-0">
      <PageHeader
        Icon={SearchIcon}
        title={m.commerce.catalog.title}
        subtitle={supplierName ?? m.commerce.catalog.subtitle}
        count={products.length}
      />
      <FilterBar
        basePath="/b2b/catalog"
        search={{ name: "q", value: sp.q ?? "", placeholder: m.commerce.catalog.searchPlaceholder }}
        selects={[
          {
            name: "category",
            label: m.commerce.fields.category,
            value: sp.category ?? "",
            anyLabel: m.commerce.catalog.allCategories,
            options: PRODUCT_CATEGORIES.map((c) => ({ value: c, label: m.commerce.categories[c] })),
          },
        ]}
      />
      <CatalogGrid products={products} orgId={org.organizationId} savedIds={[...saved]} />
    </div>
  );
}
