import Link from "next/link";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { CATALOG_VIEW_COOKIE, resolveCatalogView } from "@/lib/ui/catalog-view";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { PackageIcon, SearchIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import { parseShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";
import { CatalogResults } from "@/features/showroom-shell/catalog/catalog-results";
import { loadEngineerCatalogBatch } from "./catalog-data";
import { loadEngineerCatalogBatchAction } from "@/server/actions/engineer-catalog-feed";

const BASE_PATH = "/home/engineer/products";

/**
 * The engineer's product browser — the SHOWROOM's "Browse products" screen, for an audience
 * with no organization.
 *
 * It is not a second catalog and not a second design: same page header, same live-search filter
 * bar with the canonical category filter, same grid/list results with "show more", same empty and
 * no-results states. What differs is only who is asking — an engineer's saves go to their personal
 * collection, and instead of a showroom detail page they get "request a quote" (`mode="engineer"`).
 */
export async function EngineerCatalog({
  supabase,
  locale,
  searchParams,
}: {
  supabase: SupabaseClient<Database>;
  locale: Locale;
  searchParams: { q?: string; category?: string; supplier?: string };
}) {
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const params = parseShowroomCatalogParams(searchParams);
  const view = resolveCatalogView((await cookies()).get(CATALOG_VIEW_COOKIE)?.value);
  const batch = await loadEngineerCatalogBatch(supabase, params, 0, PAGE_BATCH);
  const { products } = batch;

  const filtered = Boolean(params.q || params.category || params.supplier);
  const supplierName = params.supplier ? (products[0]?.supplier_name ?? null) : null;
  const filterKey = JSON.stringify([params.q ?? "", params.category ?? "", params.supplier ?? ""]);

  return (
    <div className="flex flex-col gap-md" data-testid="engineer-catalog">
      <PageHeader
        locale={locale}
        Icon={PackageIcon}
        title={t("engineerCatalog.title")}
        subtitle={supplierName ? t("showroomCatalog.scopedTo", { name: supplierName }) : t("engineerCatalog.subtitle")}
      />
      <FilterBar
        liveSearch
        basePath={BASE_PATH}
        search={{ name: "q", value: params.q ?? "", placeholder: m.commerce.catalog.searchPlaceholder }}
        selects={[
          {
            name: "category",
            label: m.commerce.fields.category,
            value: params.category ?? "",
            anyLabel: m.commerce.catalog.allCategories,
            options: CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: m.commerce.canonicalCategories[c] })),
          },
        ]}
        clearLabel={t("showroomCatalog.clearFilters")}
      />
      {params.supplier ? (
        <p className="text-label">
          <Link href={BASE_PATH} className="text-accent hover:underline">{t("showroomCatalog.clearSupplier")}</Link>
        </p>
      ) : null}

      {products.length === 0 ? (
        <StatePanel
          icon={<SearchIcon size={22} />}
          title={filtered ? t("showroomCatalog.noResultsTitle") : m.commerce.catalog.emptyTitle}
          body={filtered ? t("showroomCatalog.noResultsBody") : m.commerce.catalog.emptyBody}
          action={
            filtered ? (
              <Link href={BASE_PATH} className="text-label font-medium text-accent hover:underline">
                {t("showroomCatalog.clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CatalogResults
          key={filterKey}
          mode="engineer"
          loadMore={loadEngineerCatalogBatchAction}
          products={products}
          total={batch.total}
          filters={{ q: params.q, category: params.category, supplier: params.supplier }}
          orgId={null}
          savedIds={batch.savedIds}
          initialView={view}
          imageUrls={batch.imageUrls}
        />
      )}
    </div>
  );
}
