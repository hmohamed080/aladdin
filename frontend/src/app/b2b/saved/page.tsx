import { getPageContext } from "@/server/queries/page-context";
import { BookmarkIcon } from "@/components/ui/icons";
import { getMessages } from "@/lib/i18n/translate";
import { listSavedProducts, type ProductCategory } from "@/server/queries/commerce";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import { PageHeader } from "@/components/ui/workspace-layout";
import { TabLinks } from "@/components/ui/stat-tiles";
import { SavedGrid } from "@/features/commerce/saved-grid";

export const dynamic = "force-dynamic";

/**
 * Saved Products — the buying team's shared shortlist.
 *
 * Owned by the ORGANIZATION, not the individual: when a buyer shortlists a floor
 * tile, their colleague sees it too, because purchasing in a showroom is a team
 * activity. Category tabs are built from the categories actually present in the
 * shortlist, so the filter row never offers a tab that leads to nothing.
 */
export default async function SavedProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const all = await listSavedProducts(supabase, org.organizationId);
  const category = PRODUCT_CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : "";
  const rows = category ? all.filter((r) => r.category === category) : all;

  const present = PRODUCT_CATEGORIES.filter((c) => all.some((r) => r.category === c));
  const canRequestQuote =
    org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader locale={locale} Icon={BookmarkIcon} title={m.saved.title} subtitle={m.saved.subtitle} count={all.length} />

      {present.length > 1 ? (
        <TabLinks
          locale={locale}
          basePath="/b2b/saved"
          param="category"
          current={category}
          label={m.saved.title}
          tabs={[
            { value: "", label: m.saved.allCategories, count: all.length },
            ...present.map((c) => ({
              value: c,
              label: m.commerce.categories[c],
              count: all.filter((r) => r.category === c).length,
            })),
          ]}
        />
      ) : null}

      <SavedGrid rows={rows} orgId={org.organizationId} m={m} canRequestQuote={canRequestQuote} />
    </div>
  );
}
