"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { formatCount } from "@/lib/ui/format";
import { PAGE_SIZES, pageItems, type PageSize } from "@/features/admin-preview/table-state";

const buttonBase =
  "inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm px-2.5 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * Phase 0D — the ONE pagination footer for every Admin Preview table:
 *
 *   Showing 1–10 of 213        Previous  1  2  …  22  Next      10 per page
 *
 * Rows-per-page lives here, in the footer, never in the filter bar, and reads
 * "10 per page" (not "Rows per page: 10"). Two modes, one look:
 *
 *   - URL mode (default, server-rendered directories): page and page size are
 *     `?page=` / `?pageSize=` params, changed with `router.replace` so the
 *     filters above keep their state and the scroll position does not jump.
 *   - Local mode (`onPageChange` + `onPageSizeChange` given): pure component
 *     state, for results regions that must update without any navigation
 *     (Audit's partial pagination).
 *
 * Flex order follows the document direction, so the whole strip mirrors in
 * Arabic without any RTL-specific code.
 */
export function TablePagination({
  page,
  totalPages,
  pageSize,
  from,
  to,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: PageSize;
  from: number;
  to: number;
  total: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: PageSize) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(overrides: { page?: number; pageSize?: PageSize }) {
    const params = new URLSearchParams(searchParams.toString());
    if (overrides.pageSize !== undefined) {
      if (overrides.pageSize === 10) params.delete("pageSize");
      else params.set("pageSize", String(overrides.pageSize));
      params.delete("page");
    }
    if (overrides.page !== undefined) {
      if (overrides.page <= 1) params.delete("page");
      else params.set("page", String(overrides.page));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const setPage = (p: number) => (onPageChange ? onPageChange(p) : go({ page: p }));
  const setSize = (n: PageSize) => (onPageSizeChange ? onPageSizeChange(n) : go({ pageSize: n }));

  return (
    <nav
      aria-label={t("admin.preview.table.pagination")}
      className="flex flex-wrap items-center justify-between gap-x-md gap-y-sm border-t pt-sm"
    >
      <p className="text-label text-fg-muted">
        {t("admin.preview.table.showing", {
          from: formatCount(from, locale),
          to: formatCount(to, locale),
          total: formatCount(total, locale),
        })}
      </p>

      <div className="flex flex-wrap items-center gap-x-md gap-y-sm">
        {/* Wraps: with real totals (Phase 1B-A) a full 7-page strip plus
            Previous/Next is wider than a 375px phone. */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className={cn(buttonBase, "text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40")}
          >
            {t("admin.preview.table.previous")}
          </button>
          {pageItems(page, totalPages).map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-label text-fg-muted">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={t("admin.preview.table.goToPage", { page: formatCount(item, locale) })}
                className={cn(
                  buttonBase,
                  "tabular-nums",
                  item === page ? "bg-accent-solid text-on-accent" : "text-fg-secondary hover:bg-surface-2",
                )}
              >
                {formatCount(item, locale)}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className={cn(buttonBase, "text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40")}
          >
            {t("admin.preview.table.next")}
          </button>
        </div>

        <select
          value={pageSize}
          onChange={(e) => setSize(Number(e.target.value) as PageSize)}
          aria-label={t("admin.preview.table.perPageLabel")}
          className="min-h-8 rounded-sm border border-strong bg-canvas px-2 text-label text-fg"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {t("admin.preview.table.perPage", { count: formatCount(n, locale) })}
            </option>
          ))}
        </select>
      </div>
    </nav>
  );
}
