"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Pager } from "@/components/ui/pager";
import { type PagedLoad } from "@/lib/pagination/batches";
import { usePagedList } from "@/lib/pagination/use-paged-list";
import { loadSavedBatchAction } from "@/server/actions/saved-feed";
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
type SavedCard = SavedProductRow & { id: string; product_id: string };
const toCard = (r: SavedProductRow): SavedCard[] => (r.product_id ? [{ ...r, id: r.product_id, product_id: r.product_id }] : []);

export function SavedGrid({
  rows,
  total,
  category,
  orgId,
  canRequestQuote,
}: {
  /** The FIRST batch (server-rendered); further batches are bounded server reads. */
  rows: SavedProductRow[];
  /** Everything the current category tab matches. */
  total: number;
  category: string;
  orgId: string;
  canRequestQuote: boolean;
}) {
  const { t } = useI18n();
  const load = useCallback<PagedLoad<SavedCard>>(
    async (offset) => {
      const res = await loadSavedBatchAction(category, offset);
      return res.ok ? { items: res.rows.flatMap(toCard), total: res.total } : null;
    },
    [category],
  );
  const list = usePagedList(rows.flatMap(toCard), total, load);

  if (list.items.length === 0) {
    return (
      <StatePanel
        icon={<BookmarkIcon size={22} />}
        title={t("saved.emptyTitle")}
        body={t("saved.emptyBody")}
        action={
          <Link
            href="/b2b/catalog"
            className="inline-flex min-h-9 items-center rounded-sm bg-accent-solid ring-1 ring-accent-edge px-md py-1.5 text-label font-medium text-on-accent hover:opacity-90"
          >
            {t("saved.browse")}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <ul className="grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3" data-testid="saved-grid">
      {list.items.map((p) => (
        <li key={p.product_id}>
          <Card className="flex h-full flex-col gap-sm">
            <div className="relative">
              <ProductMedia src={p.image_ref} alt={p.name ?? ""} />
              {p.category ? (
                <span className="absolute start-2 top-2">
                  <Badge tone="neutral">{t(`commerce.categories.${p.category}`)}</Badge>
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
                  <span className="shrink-0 text-success" title={t("directory.verified")}>
                    <BadgeCheckIcon size={13} />
                  </span>
                ) : null}
              </span>
              {canRequestQuote && p.supplier_org_id ? (
                <Link
                  href={`/b2b/rfqs/new?product=${p.product_id}`}
                  className="shrink-0 font-medium text-accent hover:underline"
                >
                  {t("saved.requestQuote")}
                </Link>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
      </ul>
      <Pager shown={list.items.length} total={list.total} loading={list.loading} failed={list.failed} onMore={() => void list.more()} onLess={list.less} testId="saved" />
    </div>
  );
}
