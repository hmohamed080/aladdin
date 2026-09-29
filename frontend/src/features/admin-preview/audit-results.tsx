"use client";

import { useState } from "react";
import { cn } from "@/lib/ui/cn";
import { formatDateTime, formatCount } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { StatePanel } from "@/components/ui/primitives";
import type { Locale } from "@/lib/i18n/locales";
import type { AuditEntry } from "@/server/queries/admin-preview";

const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Phase 0C — Audit pagination that updates ONLY this results region.
 *
 * `entries` arrives already filtered server-side (the actor/action/entity
 * filters still drive a real Next.js soft-navigation, same as every other
 * Admin Preview filter). Pagination itself is pure LOCAL React state — no
 * `router.push`/`replace`, no fetch, no Next.js navigation of any kind — so
 * clicking Next/Previous/a page number re-renders only this component. The
 * Admin shell, the nav, the filter controls above, and even this
 * component's own scroll position never move. This is the reference
 * pattern the task asks every future large Admin table to follow once
 * built for real (Phase 2) — see `ADMIN_IMPLEMENTATION_BACKLOG.md`.
 */
export function AuditResults({
  entries,
  locale,
  actionLabels,
  systemLabel,
  emptyTitle,
  pageSizeLabel,
  previousLabel,
  nextLabel,
  showingTemplate,
}: {
  entries: AuditEntry[];
  locale: Locale;
  actionLabels: Record<string, string>;
  systemLabel: string;
  emptyTitle: string;
  pageSizeLabel: string;
  previousLabel: string;
  nextLabel: string;
  showingTemplate: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = entries.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (entries.length === 0) return <StatePanel title={emptyTitle} />;

  return (
    <div className="flex flex-col gap-md">
      <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
        {paged.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 bg-surface px-md py-2.5 odd:bg-surface-2/30">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-fg">{e.actorName ?? systemLabel}</span>
              {e.actorRole ? <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-label text-fg-muted">{e.actorRole}</span> : null}
              <span className="text-fg-secondary">{actionLabels[auditActionKey(e.action)] ?? e.action}</span>
              <span className="min-w-0 truncate text-label text-fg-muted">· {e.subjectName ?? e.subjectType}</span>
              <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-label text-fg-muted">
          {showingTemplate
            .replace("{from}", formatCount((safePage - 1) * pageSize + 1, locale))
            .replace("{to}", formatCount(Math.min(safePage * pageSize, entries.length), locale))
            .replace("{total}", formatCount(entries.length, locale))}
        </p>
        <div className="flex items-center gap-sm">
          <label className="flex items-center gap-1.5 text-label text-fg-secondary">
            {pageSizeLabel}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(1);
              }}
              className="min-h-8 rounded-sm border border-strong bg-canvas px-2 text-label text-fg"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={cn(
                "inline-flex min-h-8 items-center justify-center rounded-sm border border-strong px-3 py-1 text-label font-medium text-fg transition-colors hover:bg-surface-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {previousLabel}
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={cn(
                "inline-flex min-h-8 items-center justify-center rounded-sm border border-strong px-3 py-1 text-label font-medium text-fg transition-colors hover:bg-surface-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
