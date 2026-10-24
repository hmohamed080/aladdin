import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { loadMarketplaceSellerStatus } from "@/server/queries/marketplace-seller";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { FilterBar } from "@/components/ui/filter-bar";
import { ButtonLink } from "@/components/ui/controls";
import { RowPublishToggle } from "@/features/marketplace-seller/row-publish";
import { QuantityStepper } from "@/features/marketplace-seller/stock-editor";
import { MARKETPLACE_IMAGE_BUCKET } from "@/features/marketplace-seller/errors";
import {
  StorefrontIcon,
  PlusIcon,
  UploadIcon,
  TruckIcon,
  PackageIcon,
  BadgeCheckIcon,
  FileTextIcon,
  AlertIcon,
  PencilIcon,
  EyeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/ui/icons";
import { formatCount } from "@/lib/ui/format";
import { formatEgp } from "@/lib/ui/egp-format";
import { cn } from "@/lib/ui/cn";
import { sellerPageAccess } from "@/features/marketplace-seller/access";
import {
  PRODUCT_STATUSES,
  SELLER_PRODUCTS_PAGE_SIZE,
  STOCK_STATES,
  displayState,
  fromPaged,
  pageWindow,
  parseFilters,
  type DisplayState,
  type PagedProducts,
} from "@/features/marketplace-seller/products-model";

export const dynamic = "force-dynamic";


const PILL: Record<DisplayState, { dot: string; chip: string }> = {
  published: { dot: "bg-success", chip: "bg-success/15 text-success" },
  draft: { dot: "bg-info", chip: "bg-info/15 text-info" },
  unpublished: { dot: "bg-fg-muted", chip: "bg-surface-2 text-fg-secondary" },
  archived: { dot: "bg-fg-muted", chip: "bg-surface-2 text-fg-secondary" },
  low: { dot: "bg-warning", chip: "bg-warning/15 text-warning" },
  out: { dot: "bg-danger", chip: "bg-danger/15 text-danger" },
};

/**
 * /b2c/seller/products — the showroom's own shelf on the public B2C Marketplace.
 *
 * B2C, NOT B2B. This is not part of the B2B Sales module or the B2B product
 * catalogue (/b2b/products): it lists canonical `marketplace_products` only and
 * shares no action with RFQs, quotations or B2B orders.
 *
 * WHO CAN SEE THIS
 * Only an organization a platform admin put through Marketplace seller
 * enablement. For every other showroom the route does not exist (404), which is
 * the same answer the sidebar gives by not drawing the module. The check is made
 * here on the server and again by the database on every write — the sidebar is
 * never the gate.
 *
 * WRITES go through the trusted seller RPCs (Migration 06): Add / Edit open the
 * product form; the inline − / + changes stock through the ledger for a product
 * with ONE active variant at ONE location (otherwise "manage stock" opens the
 * product page, where the variant and location are explicit). Bulk upload opens
 * /b2c/seller/imports. The list is paged in the database (Migration 09). Thumbnails are short-lived signed URLs of the
 * seller's own private images; customers do not see them before verification.
 */
export default async function MarketplaceProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const t = m.marketplaceSeller;
  const ar = locale === "ar";

  const status = await loadMarketplaceSellerStatus(supabase, org.organizationId);
  const access = sellerPageAccess(status);
  // Never enabled (or the preview is closed), or permanently removed: no such page.
  if (access === "not-found") notFound();

  if (access === "notice") {
    return (
      <div className="flex flex-col gap-lg">
        <PageHeader locale={locale} Icon={StorefrontIcon} title={t.title} subtitle={t.subtitle} />
        <StatePanel
          icon={<StorefrontIcon size={20} />}
          tone={status === "suspended" ? "warning" : "neutral"}
          title={status === "suspended" ? t.suspendedTitle : t.pendingTitle}
          body={status === "suspended" ? t.suspendedBody : t.pendingBody}
        />
      </div>
    );
  }

  const sp = await searchParams;
  const { data: types } = await supabase
    .from("marketplace_product_types")
    .select("key, name_ar, name_en")
    .eq("is_active", true)
    .order("sort_order");
  const typeOptions = types ?? [];
  const filters = parseFilters(
    sp,
    typeOptions.map((x) => x.key),
  );
  const requested = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  // Server-side paging (Migration 09): filters, counts and the page are computed
  // in the database, so a catalogue of thousands loads one page at a time. The
  // RPC re-checks that the caller reads for THIS (the active) organization.
  const { data: pageData } = await supabase.rpc("marketplace_seller_products_page", {
    p_organization_id: org.organizationId,
    p_query: filters.q,
    p_type: filters.type,
    p_status: filters.status,
    p_stock: filters.stock,
    p_limit: SELLER_PRODUCTS_PAGE_SIZE,
    p_offset: (requested - 1) * SELLER_PRODUCTS_PAGE_SIZE,
  });
  const paged = (pageData ?? { total: 0, stats: null, items: [] }) as unknown as PagedProducts;
  const items = (paged.items ?? []).map(fromPaged);
  const filteredTotal = Number(paged.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / SELLER_PRODUCTS_PAGE_SIZE));
  const page = Math.min(requested, pageCount);
  const stats = {
    total: Number(paged.stats?.total ?? 0),
    published: Number(paged.stats?.published ?? 0),
    draft: Number(paged.stats?.draft ?? 0),
    lowStock: Number(paged.stats?.low_stock ?? 0),
  };

  // Short-lived URLs for this page's thumbnails only (private bucket, member-scoped policy).
  const thumbKeys = items.map((p) => p.primaryImageKey).filter((k): k is string => Boolean(k));
  const thumbs = new Map<string, string>();
  if (thumbKeys.length) {
    const { data: signed } = await supabase.storage.from(MARKETPLACE_IMAGE_BUCKET).createSignedUrls(thumbKeys, 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) thumbs.set(s.path, s.signedUrl);
  }
  const isFiltered = Boolean(filters.q || filters.type || filters.status || filters.stock);

  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, type: filters.type, status: filters.status, stock: filters.stock })) {
      if (v) qs.set(k, v);
    }
    if (n > 1) qs.set("page", String(n));
    const s = qs.toString();
    return s ? `/b2c/seller/products?${s}` : "/b2c/seller/products";
  };

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <div className="flex flex-wrap items-center gap-sm">
            <ButtonLink href="/b2c/seller/delivery" variant="outline">
              <TruckIcon size={16} />
              {t.delivery.link}
            </ButtonLink>
            <ButtonLink href="/b2c/seller/imports" variant="outline">
              <UploadIcon size={16} />
              {t.bulkUpload}
            </ButtonLink>
            <ButtonLink href="/b2c/seller/products/new" variant="accent">
              <PlusIcon size={16} />
              {t.addProduct}
            </ButtonLink>
          </div>
        }
      />

      <StatTiles
        locale={locale}
        layout="strip"
        columns={4}
        tiles={[
          { label: t.stat.total, value: stats.total, Icon: PackageIcon, tone: "accent" },
          { label: t.stat.published, value: stats.published, Icon: BadgeCheckIcon, tone: "success" },
          { label: t.stat.draft, value: stats.draft, Icon: FileTextIcon, tone: "info" },
          {
            label: t.stat.lowStock,
            value: stats.lowStock,
            Icon: AlertIcon,
            tone: stats.lowStock > 0 ? "warning" : "neutral",
            href: stats.lowStock > 0 ? "/b2c/seller/products?stock=low" : undefined,
          },
        ]}
      />

      <div>
        <FilterBar
          basePath="/b2c/seller/products"
          clearLabel={t.filter.clear}
          search={{ name: "q", value: filters.q ?? "", placeholder: t.searchPlaceholder }}
          selects={[
            {
              name: "type",
              label: t.filter.type,
              value: filters.type ?? "",
              anyLabel: t.filter.anyType,
              options: typeOptions.map((x) => ({ value: x.key, label: ar ? x.name_ar : x.name_en })),
            },
            {
              name: "status",
              label: t.filter.status,
              value: filters.status ?? "",
              anyLabel: t.filter.anyStatus,
              options: PRODUCT_STATUSES.map((s) => ({ value: s, label: t.status[s] })),
            },
            {
              name: "stock",
              label: t.filter.stock,
              value: filters.stock ?? "",
              anyLabel: t.filter.anyStock,
              options: STOCK_STATES.map((s) => ({ value: s, label: t.stock[s] })),
            },
          ]}
        />

        {items.length === 0 ? (
          <StatePanel
            icon={<StorefrontIcon size={20} />}
            title={isFiltered ? t.noMatch : t.empty}
            body={isFiltered ? t.noMatchBody : t.emptyBody}
          />
        ) : (
          <div className="overflow-hidden rounded-md border bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-body">
                <thead className="text-label text-fg-secondary">
                  <tr className="border-b bg-surface-2/50">
                    <th className="px-md py-sm text-start font-medium">{t.col.product}</th>
                    <th className="px-md py-sm text-start font-medium">{t.col.type}</th>
                    <th className="px-md py-sm text-start font-medium">{t.col.sku}</th>
                    <th className="px-md py-sm text-start font-medium">{t.col.price}</th>
                    <th className="px-md py-sm text-center font-medium">{t.col.quantity}</th>
                    <th className="px-md py-sm text-center font-medium">{t.col.status}</th>
                    <th className="px-md py-sm text-center font-medium">{t.col.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const state = displayState(p);
                    const pill = PILL[state];
                    const description = ar ? p.descriptionAr : p.descriptionEn;
                    const published = p.status === "published";
                    return (
                      <tr key={p.id} className="border-b transition-colors last:border-b-0 hover:bg-surface-2/40">
                        <td className="px-md py-sm">
                          <div className="flex items-center gap-sm">
                            {p.primaryImageKey && thumbs.get(p.primaryImageKey) ? (
                              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private object
                              <img
                                src={thumbs.get(p.primaryImageKey)}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded-sm border object-cover"
                              />
                            ) : (
                              <span
                                aria-hidden="true"
                                className="grid h-14 w-14 shrink-0 place-items-center rounded-sm border bg-surface-2 text-fg-muted"
                              >
                                <PackageIcon size={20} />
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-fg">{ar ? p.nameAr : p.nameEn}</span>
                              {description ? (
                                <span className="block max-w-[18rem] truncate text-label text-fg-muted">{description}</span>
                              ) : null}
                            </span>
                          </div>
                        </td>
                        <td className="px-md py-sm">
                          {p.typeKey ? (
                            <span className="inline-flex rounded-pill bg-surface-2 px-3 py-1 text-label text-fg-secondary">
                              {ar ? p.typeNameAr : p.typeNameEn}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-md py-sm font-mono text-label text-fg-secondary" dir="ltr">
                          {p.skus[0] ?? "—"}
                          {p.variantCount > 1 ? (
                            <span className="ms-1 text-fg-muted">{t.moreSkus.replace("{n}", formatCount(p.variantCount - 1, locale))}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-md py-sm text-fg">
                          {p.fromPrice === null ? "—" : t.price.replace("{amount}", formatEgp(p.fromPrice, locale))}
                        </td>
                        <td className="px-md py-sm text-center">
                          {p.inlineStock && p.inlineStock.locationId ? (
                            <QuantityStepper
                              compact
                              variantId={p.inlineStock.variantId}
                              level={{
                                locationId: p.inlineStock.locationId,
                                locationName: "",
                                onHand: p.inlineStock.onHand,
                                reserved: p.inlineStock.reserved,
                                available: p.inlineStock.available,
                              }}
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              <span
                                className={cn(
                                  "inline-flex min-w-16 justify-center rounded-sm border px-3 py-1 tabular-nums",
                                  p.quantity <= 0 ? "text-fg-muted" : "text-fg",
                                )}
                              >
                                {formatCount(p.quantity, locale)}
                              </span>
                              <Link
                                href={`/b2c/seller/products/${p.id}/edit#variants`}
                                className="text-label text-accent hover:underline"
                                title={p.inlineStock ? undefined : t.stockEditor.multiHint}
                              >
                                {t.stockEditor.manage}
                              </Link>
                            </div>
                          )}
                        </td>
                        <td className="px-md py-sm text-center">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-label font-medium", pill.chip)}>
                            <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", pill.dot)} />
                            {t.status[state]}
                          </span>
                        </td>
                        <td className="px-md py-sm">
                          <div className="flex items-center justify-center gap-1.5">
                            <Link
                              href={`/b2c/seller/products/${p.id}/edit`}
                              aria-label={t.action.edit}
                              title={t.action.edit}
                              className="grid h-9 w-9 place-items-center rounded-sm border text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg"
                            >
                              <PencilIcon size={16} />
                            </Link>
                            {published ? (
                              <Link
                                href={`/marketplace/products/${p.slug}`}
                                aria-label={t.action.preview}
                                title={t.action.preview}
                                className="grid h-9 w-9 place-items-center rounded-sm border text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg"
                              >
                                <EyeIcon size={16} />
                              </Link>
                            ) : (
                              <IconSlot label={t.action.previewUnavailable} disabled>
                                <EyeIcon size={16} />
                              </IconSlot>
                            )}
                            <RowPublishToggle productId={p.id} status={p.status} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-sm border-t px-md py-sm">
              <span className="text-label text-fg-secondary">
                {t.showing
                  .replace("{shown}", formatCount(items.length, locale))
                  .replace("{total}", formatCount(filteredTotal, locale))}
              </span>
              {pageCount > 1 ? (
                <nav aria-label={t.pagination} className="flex items-center gap-1">
                  <PageLink href={page > 1 ? pageHref(page - 1) : null} label={t.prevPage}>
                    {ar ? <ChevronRightIcon size={16} /> : <ChevronLeftIcon size={16} />}
                  </PageLink>
                  {pageWindow(page, pageCount).map((n, i) =>
                    n === null ? (
                      <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-fg-muted">…</span>
                    ) : (
                    <Link
                      key={n}
                      href={pageHref(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={cn(
                        "grid h-8 min-w-8 place-items-center rounded-sm border px-2 text-label tabular-nums",
                        n === page ? "border-accent-edge bg-accent-solid text-on-accent" : "text-fg-secondary hover:bg-surface-2",
                      )}
                    >
                      {formatCount(n, locale)}
                    </Link>
                    ),
                  )}
                  <PageLink href={page < pageCount ? pageHref(page + 1) : null} label={t.nextPage}>
                    {ar ? <ChevronLeftIcon size={16} /> : <ChevronRightIcon size={16} />}
                  </PageLink>
                </nav>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <p className="text-label text-fg-secondary">{t.priceNote}</p>
    </div>
  );
}

/** A row action that is not available yet: shown, labelled, and inert. */
function IconSlot({ label, disabled, children }: { label: string; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-sm border text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "grid h-8 w-8 place-items-center rounded-sm border text-fg-secondary";
  if (!href) {
    return (
      <span aria-hidden="true" className={cn(cls, "opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className={cn(cls, "hover:bg-surface-2")}>
      {children}
    </Link>
  );
}
