import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount } from "@/lib/ui/format";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatePanel } from "@/components/ui/primitives";
import { PackageIcon } from "@/components/ui/icons";
import { ProductStatusBadge } from "@/features/commerce/badges";
import { ProductMedia } from "@/features/commerce/product-media";
import type { ProductRow, ProductDemand } from "@/server/queries/commerce";

/**
 * The seller's own catalogue — every product, whatever its state.
 *
 * Built on the shared `DataTable` like every other record list in the workspace,
 * rather than the hand-rolled table this used to be: the column rhythm, the
 * mobile card fallback and the empty state are then the same ones a seller has
 * already learned on Orders and Quotations.
 *
 * WHAT MAKES THIS A MANAGEMENT SURFACE RATHER THAN A LIST
 * Two columns that a plain catalogue would not have:
 *
 *   - The IMAGE, leading. A finishing catalogue is a catalogue of surfaces; a
 *     seller scanning for "the matte one" recognises it far faster than they read
 *     its SKU.
 *   - DEMAND — how many businesses have actually asked for this line. It is the
 *     one column that turns the list into a decision: a published product with no
 *     requests in six months is a pricing or a photography problem, and nothing
 *     else on this page would ever say so.
 *
 * There is deliberately no stock level, no warehouse, no reorder point and no
 * margin. The reference set shows all four; this repository has no inventory
 * model, and a stock number with nothing behind it is the one thing on a supply
 * screen that must never be invented.
 *
 * Server component — it takes resolved rows, so the client bundle does not grow.
 */
export function ProductsTable({
  products,
  demand,
  m,
  locale,
  emptyTitle,
  emptyBody,
}: {
  products: ProductRow[];
  /** Per-product request counts, keyed by product id. Absent = not looked up. */
  demand?: Map<string, ProductDemand>;
  m: Messages;
  locale: Locale;
  emptyTitle: string;
  emptyBody: string;
}) {
  // No local `Intl` instance: a table that formats its own numbers is how the
  // two numeral systems got onto one page in the first place.
  const number = (n: number) => formatCount(n, locale);

  const columns: Column<ProductRow>[] = [
    {
      key: "product",
      header: m.commerce.fields.name,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-12 shrink-0">
            <ProductMedia src={p.image_ref} alt={p.name} />
          </div>
          <div className="min-w-0">
            <Link
              href={`/b2b/products/${p.id}`}
              className="block truncate font-medium text-fg hover:text-accent"
            >
              {p.name}
            </Link>
            <span className="mt-0.5 block truncate text-label text-fg-muted">
              {p.brand ?? m.commerce.categories[p.category]}
              {p.sku ? ` · ${p.sku}` : ""}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: m.commerce.fields.category,
      cell: (p) => m.commerce.categories[p.category],
    },
    {
      key: "unit",
      header: m.commerce.fields.unit,
      desktopOnly: true,
      secondary: true,
      cell: (p) => m.commerce.units[p.unit],
    },
    ...(demand
      ? [
          {
            key: "demand",
            header: m.supply.products.column.demand,
            numeric: true,
            cell: (p: ProductRow) => {
              const d = demand.get(p.id);
              return d && d.requests > 0 ? (
                <span className="font-medium text-fg tabular-nums">
                  {d.requests === 1
                    ? m.supply.products.demandRequestOne
                    : m.supply.products.demandRequests.replace("{count}", number(d.requests))}
                </span>
              ) : (
                <span className="text-fg-muted">{m.supply.products.demandNone}</span>
              );
            },
          } satisfies Column<ProductRow>,
        ]
      : []),
    {
      key: "status",
      header: m.commerce.fields.status,
      numeric: true,
      cell: (p) => <ProductStatusBadge status={p.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={products}
      rowKey={(p) => p.id}
      caption={m.supply.products.title}
      empty={<StatePanel icon={<PackageIcon size={22} />} title={emptyTitle} body={emptyBody} />}
    />
  );
}
