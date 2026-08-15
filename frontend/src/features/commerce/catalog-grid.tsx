"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { SearchIcon, BadgeCheckIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";

/**
 * Responsive product-card grid for the professional B2B catalog.
 *
 * Each card answers four things and no more: what it is (image, name, brand),
 * what kind of thing (category), who sells it (distributor + whether Aladdin has
 * verified them), and how it is sold (unit). There is deliberately NO price and
 * NO add-to-cart: Aladdin is consultation-first, the catalog carries no price
 * column at all, and a real B2B price comes from a quote against a real quantity,
 * not from a shelf label.
 *
 * The save toggle is the one interactive control on a card, and it sits OUTSIDE
 * the card's link — a nested <form> inside an <a> is invalid HTML and would make
 * saving a product navigate away instead.
 */
export function CatalogGrid({
  products,
  orgId,
  savedIds,
}: {
  products: CatalogRow[];
  orgId: string;
  /** Product ids already on this organization's shortlist. */
  savedIds: string[];
}) {
  const { t } = useI18n();
  const saved = new Set(savedIds);

  if (products.length === 0) {
    return (
      <StatePanel
        icon={<SearchIcon size={22} />}
        title={t("commerce.catalog.emptyTitle")}
        body={t("commerce.catalog.emptyBody")}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
      {products.map((p) => (
        <li key={p.id}>
          <Card className="group flex h-full flex-col gap-sm transition-colors hover:border-strong">
            <div className="relative">
              <ProductMedia src={p.image_ref} alt={p.name ?? ""} />
              {/* Overlaid so the image stays the full width of the card — the
                  category is a label ON the product, not a row beside it. */}
              <span className="absolute start-2 top-2">
                <Badge tone="neutral">{t(`commerce.categories.${p.category}`)}</Badge>
              </span>
              {p.id ? (
                <span className="absolute end-2 top-2">
                  <SaveProductButton orgId={orgId} productId={p.id} saved={saved.has(p.id)} compact />
                </span>
              ) : null}
            </div>

            <Link href={`/b2b/catalog/${p.id}`} className="flex min-w-0 flex-1 flex-col">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-medium text-fg group-hover:text-accent">{p.name}</h3>
                {p.brand ? <p className="mt-0.5 text-label text-fg-muted">{p.brand}</p> : null}
                {p.short_description ? (
                  <p className="mt-1.5 line-clamp-2 text-body text-fg-secondary">{p.short_description}</p>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between gap-sm border-t pt-sm text-label">
                <span className="inline-flex min-w-0 items-center gap-1 text-fg-secondary">
                  <span className="truncate">{p.supplier_name}</span>
                  {p.supplier_verified ? (
                    <span className="shrink-0 text-success" title={t("commerce.catalog.verifiedSupplier")}>
                      <BadgeCheckIcon size={13} />
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-fg-muted">{t(`commerce.units.${p.unit}`)}</span>
              </div>
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}
