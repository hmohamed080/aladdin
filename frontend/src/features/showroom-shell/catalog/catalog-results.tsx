"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { type CatalogView } from "@/lib/ui/catalog-view";
import { Pager } from "@/components/ui/pager";
import { type PagedLoad } from "@/lib/pagination/batches";
import { usePagedList } from "@/lib/pagination/use-paged-list";
import { loadCatalogBatchAction, type CatalogBatchResult } from "@/server/actions/catalog-feed";
import type { CatalogRow } from "@/server/queries/commerce";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { GridCard, ListRow, isRenderable, type CatalogMode, type Product } from "./product-cards";

/**
 * The showroom's product results: one result set, two presentations.
 *
 * The mode is client state seeded from the cookie the server already read, so the
 * toggle is instant and the first paint is already the remembered layout. Both
 * modes share the same links, the same save control and the same fields; only the
 * arrangement differs. The save control always sits OUTSIDE the product link — a
 * <form> inside an <a> is invalid and saving must never navigate away.
 */
export function CatalogResults({
  products,
  total,
  filters,
  orgId,
  savedIds,
  initialView,
  imageUrls: initialImageUrls = {},
  mode = "showroom",
  loadMore = loadCatalogBatchAction,
}: {
  /** The FIRST batch (server-rendered); further batches are bounded server reads. */
  products: CatalogRow[];
  /** Everything the current filters match — the batch size is never the count. */
  total: number;
  /** The URL filters, forwarded to "Show more" (the server re-validates them). */
  filters: { q?: string; category?: string; supplier?: string };
  /** Product id -> resolved image URL (signed primary photo, else the legacy reference). */
  imageUrls?: Record<string, string>;
  /** The viewing organization; `null` for an engineer, who has none. */
  orgId: string | null;
  savedIds: string[];
  initialView: CatalogView;
  /** Who is browsing — see `CatalogMode`. Defaults to the showroom. */
  mode?: CatalogMode;
  /**
   * The "Show more" read. Defaults to the showroom's own; another audience passes its server action
   * (server actions can be handed from a server page to this client component), so this file never
   * has to know about it.
   */
  loadMore?: (filters: { q?: string; category?: string; supplier?: string }, offset: number) => Promise<CatalogBatchResult>;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const [imageUrls, setImageUrls] = useState(initialImageUrls);
  const [saved, setSaved] = useState(() => new Set(savedIds));

  // The server action is the only thing that knows the viewer's organization; a failed batch keeps the list.
  const load = useCallback<PagedLoad<Product>>(
    async (offset) => {
      const res = await loadMore(filters, offset);
      if (!res.ok) return null;
      setImageUrls((prev) => ({ ...prev, ...res.imageUrls }));
      // The batch's own save state is authoritative (it may have changed since an earlier load).
      setSaved((prev) => {
        const next = new Set(prev);
        for (const p of res.products) if (p.id) next.delete(p.id);
        for (const id of res.savedIds) next.add(id);
        return next;
      });
      return { items: res.products.filter(isRenderable), total: res.total };
    },
    [filters, loadMore],
  );
  const list = usePagedList(products.filter(isRenderable), total, load);
  const items = list.items;
  const onSavedChange = (id: string) => (next: boolean) =>
    setSaved((prev) => {
      const set = new Set(prev);
      if (next) set.add(id);
      else set.delete(id);
      return set;
    });

  return (
    <section className="flex flex-col gap-md" aria-label={t("showroomCatalog.title")}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-label text-fg-muted" data-testid="showroom-catalog-count">{t("showroomCatalog.count", { count: String(list.total) })}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="showroom-catalog" />
      </div>

      {view === "grid" ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4 wide:grid-cols-5" data-testid="showroom-catalog-grid">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <GridCard product={p} orgId={orgId} mode={mode} saved={saved.has(p.id)} image={imageUrls[p.id] ?? p.image_ref} onSavedChange={onSavedChange(p.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-sm" data-testid="showroom-catalog-list">
          {items.map((p) => (
            <li key={p.id} className="min-w-0">
              <ListRow product={p} orgId={orgId} mode={mode} saved={saved.has(p.id)} image={imageUrls[p.id] ?? p.image_ref} onSavedChange={onSavedChange(p.id)} />
            </li>
          ))}
        </ul>
      )}
      <Pager shown={items.length} total={list.total} loading={list.loading} failed={list.failed} onMore={() => void list.more()} onLess={list.less} testId="showroom-catalog" />
    </section>
  );
}
