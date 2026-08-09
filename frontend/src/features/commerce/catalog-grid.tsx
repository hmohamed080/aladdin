"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { PackageIcon, SearchIcon } from "@/components/ui/icons";
import type { CatalogRow } from "@/server/queries/commerce";

/**
 * Responsive product-card grid for the professional B2B catalog. Each card shows
 * the product, its supplier identity, and links to the detail page where a quote
 * can be requested. Not a consumer marketplace: no prices, no add-to-cart.
 */
export function CatalogGrid({ products }: { products: CatalogRow[] }) {
  const { t } = useI18n();

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
          <Link href={`/b2b/catalog/${p.id}`} className="group block h-full">
            <Card className="flex h-full flex-col gap-sm transition-colors hover:border-strong">
              <div className="flex items-start justify-between gap-sm">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-secondary">
                  <PackageIcon size={20} />
                </span>
                <Badge tone="neutral">{t(`commerce.categories.${p.category}`)}</Badge>
              </div>
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
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
