"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { PackageIcon, SearchIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import type { CatalogRow } from "@/server/queries/commerce";

/**
 * Responsive product-card grid for the professional B2B catalog. Each card shows
 * the product, its supplier identity, and links to the detail page where a quote
 * can be requested. Not a consumer marketplace: no prices, no add-to-cart.
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
            <div className="flex items-start justify-between gap-sm">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-secondary">
                <PackageIcon size={20} />
              </span>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{t(`commerce.categories.${p.category}`)}</Badge>
                {p.id ? (
                  <SaveProductButton orgId={orgId} productId={p.id} saved={saved.has(p.id)} compact />
                ) : null}
              </div>
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
                    <span className="text-success" title={t("commerce.catalog.verifiedSupplier")}>
                      ✓
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
