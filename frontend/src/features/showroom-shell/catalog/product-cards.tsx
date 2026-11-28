"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/primitives";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import { EngineerSaveProductButton } from "@/features/engineer/save-product-icon";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { catalogCategoryLabel, productMetaLine } from "@/features/showroom-shell/products/labels";
import { effectiveColors } from "@/features/showroom-shell/products/color-items";
import { SwatchRow } from "@/features/showroom-shell/products/color-swatches";

export type Product = CatalogRow & { id: string; category: NonNullable<CatalogRow["category"]>; unit: NonNullable<CatalogRow["unit"]> };

/** A view row whose core fields are missing is not a product the UI can describe — same rule as the detail page. */
export const isRenderable = (p: CatalogRow): p is Product => Boolean(p.id && p.category && p.unit);

/**
 * Public discovery metadata only: code, colors and "unit • size • weight". There is no
 * price here by design — Aladdin is a discovery + quotation platform, and the only price
 * another organization ever sees is a Product Offer's.
 */
function useMeta(product: Product) {
  const { t } = useI18n();
  return {
    meta: productMetaLine(t, { unit: product.unit, sizeLabel: product.size_label, weightKg: product.weight_kg }),
    colors: effectiveColors(product),
  };
}

/**
 * Who is browsing. The cards are ONE design for every audience; the mode only swaps the three things
 * that depend on who is looking: where "details" goes, which save control is shown, and (for an
 * engineer, who has no showroom page to open) a "request a quote" action instead of a details link.
 * `"showroom"` is the default and is exactly what the showroom has always rendered.
 */
export type CatalogMode = "showroom" | "engineer";

const detailHref = (id: string) => `${SHOWROOM_ROOT}/catalog/${id}`;
const quoteHref = (id: string) => `/home/engineer/requests/new?product=${id}`;

function SaveControl({ mode, orgId, productId, saved, onChange }: { mode: CatalogMode; orgId: string | null; productId: string; saved: boolean; onChange?: (saved: boolean) => void }) {
  if (mode === "engineer") return <EngineerSaveProductButton productId={productId} saved={saved} onChange={onChange} />;
  return orgId ? <SaveProductButton orgId={orgId} productId={productId} saved={saved} compact onChange={onChange} /> : null;
}

const QUOTE_LINK = "inline-flex h-9 w-full shrink-0 items-center justify-center rounded-sm border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Supplier({ product }: { product: Product }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-fg-secondary">
      <span className="truncate" dir="auto">{product.supplier_name}</span>
      {product.supplier_verified ? (
        <span className="shrink-0 text-success" title={t("commerce.catalog.verifiedSupplier")}>
          <BadgeCheckIcon size={13} />
        </span>
      ) : null}
    </span>
  );
}

export function GridCard({ product, orgId, saved, image, onSavedChange, mode = "showroom" }: { product: Product; orgId: string | null; saved: boolean; image: string | null; onSavedChange?: (saved: boolean) => void; mode?: CatalogMode }) {
  const { t } = useI18n();
  const { meta, colors } = useMeta(product);
  return (
    <div className="group flex h-full flex-col gap-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:p-sm" data-testid="showroom-catalog-card">
      <div className="relative">
        <ProductMedia src={image} alt={product.name ?? ""} aspect="aspect-[4/3] tablet:aspect-[16/9]" />
        <span className="absolute start-1.5 top-1.5 max-w-[calc(100%-3.5rem)]">
          <Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge>
        </span>
        <span className="absolute end-1.5 top-1.5">
          <SaveControl mode={mode} orgId={orgId} productId={product.id} saved={saved} onChange={onSavedChange} />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {mode === "engineer" ? (
          <p className="line-clamp-2 w-full text-body font-medium leading-snug text-fg" dir="auto">{product.name}</p>
        ) : (
          <Link href={detailHref(product.id)} className="line-clamp-2 w-full text-body font-medium leading-snug text-fg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" dir="auto">
            {product.name}
          </Link>
        )}
        {product.sku ? <p className="w-full truncate text-label text-fg-muted" data-testid="card-code"><span>{t("showroomProducts.code")}: </span><span dir="ltr">{product.sku}</span></p> : null}
        <SwatchRow colors={colors} />
        {meta ? <p className="w-full text-label text-fg-muted" dir="auto" data-testid="card-meta">{meta}</p> : null}
        <div className="mt-auto w-full border-t pt-2 text-label">
          <Supplier product={product} />
        </div>
        {mode === "engineer" ? <Link href={quoteHref(product.id)} className={QUOTE_LINK}>{t("engineerCatalog.requestQuote")}</Link> : null}
      </div>
    </div>
  );
}

export function ListRow({ product, orgId, saved, image, onSavedChange, mode = "showroom" }: { product: Product; orgId: string | null; saved: boolean; image: string | null; onSavedChange?: (saved: boolean) => void; mode?: CatalogMode }) {
  const { t } = useI18n();
  const { meta, colors } = useMeta(product);
  return (
    <div className="group flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-2 transition-colors hover:border-strong tablet:flex-nowrap tablet:p-sm" data-testid="showroom-catalog-row">
      {(() => {
        const identity = (
          <>
            <div className="w-16 shrink-0 tablet:w-20">
              <ProductMedia src={image} alt={product.name ?? ""} aspect="aspect-square" />
            </div>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={mode === "engineer" ? "line-clamp-2 text-body font-medium leading-snug text-fg" : "line-clamp-2 text-body font-medium leading-snug text-fg group-hover:text-accent"} dir="auto">{product.name}</span>
              {product.sku ? <span className="truncate text-label text-fg-muted" dir="ltr" data-testid="card-code">{product.sku}</span> : null}
            </span>
          </>
        );
        const identityClass = "flex min-w-0 flex-1 basis-[calc(100%-3.5rem)] items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:basis-auto";
        return mode === "engineer"
          ? <div className={identityClass}>{identity}</div>
          : <Link href={detailHref(product.id)} className={identityClass}>{identity}</Link>;
      })()}
      <span className="order-last flex w-full min-w-0 items-center gap-x-sm text-label tablet:order-none tablet:w-auto tablet:gap-x-md">
        <span className="shrink-0"><Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge></span>
        <span className="flex min-w-0 flex-1 tablet:w-52 tablet:flex-none"><Supplier product={product} /></span>
        <span className="min-w-0 truncate text-fg-muted tablet:w-44" dir="auto" data-testid="card-meta">{meta}</span>
        <SwatchRow colors={colors} max={4} />
      </span>
      <SaveControl mode={mode} orgId={orgId} productId={product.id} saved={saved} onChange={onSavedChange} />
      <Link
        href={mode === "engineer" ? quoteHref(product.id) : detailHref(product.id)}
        className="order-last inline-flex h-9 w-full shrink-0 items-center justify-center rounded-sm tablet:w-auto border border-strong px-3 text-label font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:order-none"
      >
        {mode === "engineer" ? t("engineerCatalog.requestQuote") : t("showroomCatalog.viewDetails")}
      </Link>
    </div>
  );
}
