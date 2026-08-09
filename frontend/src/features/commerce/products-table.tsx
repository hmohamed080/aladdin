"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, StatePanel } from "@/components/ui/primitives";
import { PackageIcon } from "@/components/ui/icons";
import { ProductStatusBadge } from "@/features/commerce/badges";
import type { ProductRow } from "@/server/queries/commerce";

/**
 * The supplier's own product list (all statuses). Responsive: a compact table on
 * tablet+ and stacked cards on mobile. Rows link to the product detail page.
 */
export function ProductsTable({ products }: { products: ProductRow[] }) {
  const { t } = useI18n();

  if (products.length === 0) {
    return (
      <StatePanel
        icon={<PackageIcon size={22} />}
        title={t("commerce.products.emptyTitle")}
        body={t("commerce.products.emptyBody")}
      />
    );
  }

  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="flex flex-col gap-sm tablet:hidden">
        {products.map((p) => (
          <Link key={p.id} href={`/b2b/products/${p.id}`} className="block">
            <Card pad="sm" className="transition-colors hover:border-strong">
              <div className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{p.name}</p>
                  <p className="mt-0.5 text-label text-fg-muted">
                    {t(`commerce.categories.${p.category}`)}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </p>
                </div>
                <ProductStatusBadge status={p.status} />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Tablet+: table */}
      <Card pad="sm" className="hidden overflow-x-auto tablet:block">
        <table className="w-full min-w-[36rem] border-collapse text-body">
          <thead>
            <tr className="border-b text-start text-label text-fg-muted">
              <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.name")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.category")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.sku")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.unit")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("commerce.fields.status")}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-surface-2/50">
                <td className="px-2 py-2.5">
                  <Link href={`/b2b/products/${p.id}`} className="font-medium text-fg hover:text-accent">
                    {p.name}
                  </Link>
                  {p.brand ? <span className="ms-2 text-label text-fg-muted">{p.brand}</span> : null}
                </td>
                <td className="px-2 py-2.5 text-fg-secondary">{t(`commerce.categories.${p.category}`)}</td>
                <td className="px-2 py-2.5 text-fg-secondary" dir="ltr">{p.sku ?? "—"}</td>
                <td className="px-2 py-2.5 text-fg-secondary">{t(`commerce.units.${p.unit}`)}</td>
                <td className="px-2 py-2.5 text-end">
                  <ProductStatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
