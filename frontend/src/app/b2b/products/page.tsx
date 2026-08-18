import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listOwnProducts,
  ownProductCounts,
  productDemand,
  type ProductCategory,
} from "@/server/queries/commerce";
import { commerceStance, supplyVoice } from "@/lib/workspace/supply-side";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { StatTiles, TabLinks } from "@/components/ui/stat-tiles";
import { FilterBar } from "@/components/ui/filter-bar";
import { ProductsTable } from "@/features/commerce/products-table";
import { PackageIcon, BadgeCheckIcon, FileTextIcon, DemandIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const STATUSES = ["published", "draft"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Product management — the seller's catalogue and the demand behind it.
 *
 * This is the module a Distributor, Manufacturer or Importer lives in between
 * requests, and it is the same one for all three: what differs is a single line
 * of subtitle, because a manufacturer says "what you make" where an importer says
 * "what you import". Nothing else forks.
 *
 * FOUR THINGS A LIST ALONE DOES NOT DO, ADDED HERE
 *   1. Counts that answer "is my shelf actually live" — published vs draft, read
 *      UNFILTERED so the tabs report the catalogue rather than the current view.
 *   2. Status tabs, because "which of mine are still drafts" is the single most
 *      common question and it should not require a filter dropdown.
 *   3. Search and category filters in the URL, so a filtered catalogue is a
 *      shareable link and this page stays a server component.
 *   4. Demand per product, which is what makes the list actionable at all.
 *
 * SCOPE HELD DELIBERATELY
 * No stock, no warehouse, no reorder points, no margin, no price-list versioning,
 * no checkout. The reference set shows several of these; none has a model here.
 * Publishing state, category, unit, media and demand are what genuinely exist.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; category?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const canWrite =
    org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const isSeller = commerceStance(org.orgType) === "seller";

  // URL input is validated against what this page offers, never passed through to
  // the database — a list must not be steerable into a query the module does not
  // define.
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Status)
    : undefined;
  const category = PRODUCT_CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : undefined;
  const search = sp.q?.trim() || undefined;

  const [products, counts, demand] = await Promise.all([
    listOwnProducts(supabase, org.organizationId, { status, category, search }),
    ownProductCounts(supabase, org.organizationId),
    // Demand is a supply-side question. A showroom's own shelf is sold over the
    // counter, so the two extra reads are not spent on a buyer-seat workspace.
    isSeller ? productDemand(supabase, org.organizationId) : Promise.resolve(undefined),
  ]);

  const requested = demand ? [...demand.values()].filter((d) => d.requests > 0).length : 0;
  const filtered = Boolean(status || category || search);

  // A caller with no catalogue rights and nothing to look at gets a plain
  // explanation instead of an empty toolbar over an empty table.
  if (!canWrite && counts.total === 0) {
    return (
      <div className="pb-16 tablet:pb-0">
        <PageHeader locale={locale} title={m.commerce.products.title} subtitle={m.commerce.products.subtitle} />
        <StatePanel
          title={m.commerce.products.noAccessTitle}
          body={m.commerce.products.noAccessBody}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={PackageIcon}
        title={isSeller ? m.supply.products.title : m.commerce.products.title}
        subtitle={
          isSeller
            ? m.supply.voice[supplyVoice(org.orgType)].productsSubtitle
            : m.commerce.products.subtitle
        }
        count={products.length}
        action={canWrite ? { href: "/b2b/products/new", label: m.commerce.products.new } : undefined}
        toolbar={
          isSeller ? (
            <Link href="/b2b/rfqs" className="text-label font-medium text-accent hover:underline">
              {m.supply.demand.title} →
            </Link>
          ) : undefined
        }
      />

      <StatTiles
        locale={locale}
        layout="strip"
        tiles={[
          { label: m.supply.products.stat.total, value: counts.total, Icon: PackageIcon, tone: "accent" },
          {
            label: m.supply.products.stat.published,
            value: counts.published,
            Icon: BadgeCheckIcon,
            tone: "success",
          },
          {
            label: m.supply.products.stat.draft,
            value: counts.draft,
            Icon: FileTextIcon,
            // A draft is not an error, but it IS invisible to buyers, and that is
            // worth flagging on a page whose whole point is being findable.
            tone: counts.draft > 0 ? "warning" : "neutral",
            hint: counts.draft > 0 ? m.supply.tile.draftsHint : undefined,
          },
          ...(demand
            ? [
                {
                  label: m.supply.products.stat.requested,
                  value: requested,
                  Icon: DemandIcon,
                  tone: "info" as const,
                  hint: m.supply.products.stat.requestedHint,
                },
              ]
            : []),
        ]}
      />

      <div>
        <TabLinks
          locale={locale}
          basePath="/b2b/products"
          param="status"
          current={status ?? ""}
          label={m.supply.products.title}
          // Carried so a tab change keeps the search and category the seller set.
          keep={{ q: search, category }}
          tabs={[
            { value: "", label: m.supply.products.tab.all, count: counts.total },
            { value: "published", label: m.supply.products.tab.published, count: counts.published },
            { value: "draft", label: m.supply.products.tab.draft, count: counts.draft },
          ]}
        />

        <FilterBar
          basePath="/b2b/products"
          clearLabel={m.reports.filters.clear}
          search={{ name: "q", value: search ?? "", placeholder: m.supply.products.searchPlaceholder }}
          selects={[
            {
              name: "category",
              label: m.supply.products.filterCategory,
              value: category ?? "",
              anyLabel: m.reports.filters.allCategories,
              options: PRODUCT_CATEGORIES.map((c) => ({ value: c, label: m.commerce.categories[c] })),
            },
          ]}
        />

        {status === "draft" && products.length > 0 ? (
          <p className="mb-md text-label text-fg-muted">{m.supply.products.draftNotice}</p>
        ) : null}

        <ProductsTable
          products={products}
          demand={demand}
          m={m}
          locale={locale}
          /* "You have no products" and "nothing matched your filter" are different
             problems with different fixes, so they are different empty states. */
          emptyTitle={filtered ? m.supply.products.noMatch : m.supply.products.empty}
          emptyBody={filtered ? m.supply.products.noMatchBody : m.supply.products.emptyBody}
        />
      </div>
    </div>
  );
}
