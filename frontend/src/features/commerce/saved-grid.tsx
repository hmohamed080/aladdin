import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages/en";
import { Card, Badge, StatePanel } from "@/components/ui/primitives";
import { BookmarkIcon, BadgeCheckIcon } from "@/components/ui/icons";
import { SaveProductButton } from "@/features/commerce/save-product-button";
import { ProductMedia } from "@/features/commerce/product-media";
import type { SavedProductRow } from "@/server/queries/commerce";

/**
 * The buying team's shortlist.
 *
 * Each card offers exactly two moves: open the product, or request a price for
 * it. There is deliberately NO cart and NO price on the card — a saved product is
 * a shortlist entry, and in a consultation-first product the price comes from a
 * real quote against a real quantity, not from a shelf label.
 *
 * Same card anatomy as the catalog grid, because these ARE catalog products: a
 * shortlist that looked like a different kind of object would make the buyer
 * re-learn the layout on the second screen of the same task.
 */
export function SavedGrid({
  rows,
  orgId,
  m,
  canRequestQuote,
}: {
  rows: SavedProductRow[];
  orgId: string;
  m: Messages;
  canRequestQuote: boolean;
}) {
  if (rows.length === 0) {
    return (
      <StatePanel
        icon={<BookmarkIcon size={22} />}
        title={m.saved.emptyTitle}
        body={m.saved.emptyBody}
        action={
          <Link
            href="/b2b/catalog"
            className="inline-flex min-h-9 items-center rounded-sm bg-accent-solid px-md py-1.5 text-label font-medium text-on-accent hover:opacity-90"
          >
            {m.saved.browse}
          </Link>
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
      {rows.map((p) => (
        <li key={p.product_id}>
          <Card className="flex h-full flex-col gap-sm">
            <div className="relative">
              <ProductMedia src={p.image_ref} alt={p.name ?? ""} />
              {p.category ? (
                <span className="absolute start-2 top-2">
                  <Badge tone="neutral">{m.commerce.categories[p.category]}</Badge>
                </span>
              ) : null}
              {p.product_id ? (
                <span className="absolute end-2 top-2">
                  <SaveProductButton orgId={orgId} productId={p.product_id} saved compact />
                </span>
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 font-medium text-fg">
                <Link href={`/b2b/catalog/${p.product_id}`} className="hover:text-accent hover:underline">
                  {p.name}
                </Link>
              </h3>
              {p.brand ? <p className="mt-0.5 text-label text-fg-muted">{p.brand}</p> : null}
              {p.short_description ? (
                <p className="mt-1.5 line-clamp-2 text-body text-fg-secondary">{p.short_description}</p>
              ) : null}
              {/* Why this was shortlisted, in the buyer's own words — the reason a
                  team shortlist beats a personal one. */}
              {p.note ? (
                <p className="mt-2 rounded-sm bg-surface-2 px-2 py-1 text-label text-fg-secondary">{p.note}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-sm border-t pt-sm text-label">
              <span className="inline-flex min-w-0 items-center gap-1 text-fg-secondary">
                <span className="truncate">{p.supplier_name}</span>
                {p.supplier_verified ? (
                  <span className="shrink-0 text-success" title={m.directory.verified}>
                    <BadgeCheckIcon size={13} />
                  </span>
                ) : null}
              </span>
              {canRequestQuote ? (
                <Link
                  href={`/b2b/rfqs/new?product=${p.product_id}`}
                  className="shrink-0 font-medium text-accent hover:underline"
                >
                  {m.saved.requestQuote}
                </Link>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
