"use client";

import { Fragment, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { StatePanel } from "@/components/ui/primitives";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { paginate, type PageSize } from "@/features/admin-preview/table-state";

/** A fully prepared, serializable audit row — every string is already localized/formatted on the server. */
export type AuditRow = {
  id: string;
  actor: string;
  role: string | null;
  action: string;
  entity: string;
  /** Short summary shown in the collapsed row (reason, else first recorded fact), or null. */
  summary: string | null;
  context: string | null;
  dateTime: string;
  detail: {
    target: string;
    reference: string | null;
    reason: string | null;
    before: string | null;
    after: string | null;
    organization: string | null;
    rest: { key: string; value: string }[];
  };
};

/**
 * Audit results — Phase 0D presentation, Phase 0C partial-pagination pattern.
 *
 * Columns: Actor · Action · Entity · Details · Context · Date & time. A row
 * expands to show the target, before/after, reason, reference id and any other
 * recorded facts as labelled fields — never raw JSON by default.
 *
 * `rows` arrive already filtered server-side (the filters drive a Next.js
 * soft-navigation). Pagination is LOCAL state: `TablePagination` in local mode,
 * so Next/Previous/page size re-render only this component — the shell, nav,
 * filters and URL never move. The same component in URL mode is what every
 * other Admin table uses, so the footer looks identical everywhere.
 *
 * Admin Audit (admin/system actions) is never mixed with Analytics events.
 */
export function AuditResults({ rows }: { rows: AuditRow[] }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  if (rows.length === 0) return <StatePanel title={t("admin.preview.audit.empty")} />;

  const slice = paginate(rows, page, pageSize);
  const cols = "admin.preview.audit.columns";

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const Detail = ({ row }: { row: AuditRow }) => (
    <dl className="grid gap-x-lg gap-y-sm text-body tablet:grid-cols-2">
      <DetailField label={t("admin.preview.audit.detail.target")} value={row.detail.target} />
      <DetailField label={t("admin.preview.audit.detail.reference")} value={row.detail.reference} mono />
      <DetailField label={t("admin.preview.audit.detail.reason")} value={row.detail.reason} />
      <DetailField label={t("admin.preview.audit.detail.organization")} value={row.detail.organization} />
      {row.detail.before || row.detail.after ? (
        <div className="tablet:col-span-2">
          <dt className="text-label text-fg-muted">
            {t("admin.preview.audit.detail.before")} → {t("admin.preview.audit.detail.after")}
          </dt>
          <dd className="text-fg">
            {row.detail.before ?? "—"} → {row.detail.after ?? "—"}
          </dd>
        </div>
      ) : null}
      {row.detail.rest.length > 0 ? (
        <div className="tablet:col-span-2">
          <dt className="text-label text-fg-muted">{t("admin.preview.audit.detail.metadata")}</dt>
          <dd>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {row.detail.rest.map((r) => (
                <li key={r.key} className="text-fg-secondary">
                  <span className="text-fg-muted">{r.key}: </span>
                  {r.value}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : row.detail.reason || row.detail.reference || row.detail.before ? null : (
        <p className="text-label text-fg-muted tablet:col-span-2">{t("admin.preview.audit.detail.noMetadata")}</p>
      )}
    </dl>
  );

  const toggleLabel = (isOpen: boolean) => t(isOpen ? "admin.preview.audit.collapse" : "admin.preview.audit.expand");

  return (
    <div className="flex flex-col gap-md">
      {/* Desktop: a real table; the page never scrolls sideways (the table does, inside its own box). */}
      <div className="hidden overflow-hidden rounded-md border bg-surface shadow-card desktop:block">
        {/* `relative` is load-bearing: the table holds `sr-only` (position:absolute) labels, and an absolutely
            positioned box is clipped by a scroll container ONLY when that container is its containing block.
            Without it the 1px labels escape the clip at the table's scrolled-out edge and widen the whole page. */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-body">
            <caption className="sr-only">{t("admin.preview.audit.title")}</caption>
            <thead>
              <tr className="border-b bg-surface-2/50 text-start text-label font-medium text-fg-muted">
                {["actor", "action", "entity", "details", "context", "dateTime"].map((k) => (
                  <th key={k} scope="col" className="whitespace-nowrap px-md py-2.5 text-start font-medium">
                    {t(`${cols}.${k}`)}
                  </th>
                ))}
                <th scope="col" className="w-10 px-md py-2.5">
                  <span className="sr-only">{t("admin.preview.audit.expand")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {slice.rows.map((e) => {
                const isOpen = open.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr className="border-b align-top last:border-0 odd:bg-surface-2/20">
                      <td className="min-w-[12rem] px-md py-3">
                        <span className="font-medium text-fg">{e.actor}</span>
                        {e.role ? <span className="ms-1.5 rounded-pill bg-surface-2 px-1.5 py-0.5 text-label text-fg-muted">{e.role}</span> : null}
                      </td>
                      <td className="min-w-[12rem] px-md py-3 text-fg-secondary">{e.action}</td>
                      <td className="min-w-[10rem] px-md py-3 text-fg-secondary">{e.entity}</td>
                      <td className="min-w-[14rem] px-md py-3 text-fg-secondary">{e.summary ?? <span className="text-fg-muted">—</span>}</td>
                      <td className="min-w-[9rem] px-md py-3 text-fg-secondary">{e.context ?? t("admin.preview.audit.contextNone")}</td>
                      <td className="whitespace-nowrap px-md py-3 text-label text-fg-muted">{e.dateTime}</td>
                      <td className="px-md py-2">
                        <ExpandButton open={isOpen} label={toggleLabel(isOpen)} onClick={() => toggle(e.id)} />
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b bg-surface-2/40 last:border-0">
                        <td colSpan={7} className="px-md py-3">
                          <Detail row={e} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Below desktop: the same rows as stacked cards. */}
      <ul className="flex flex-col gap-sm desktop:hidden">
        {slice.rows.map((e) => {
          const isOpen = open.has(e.id);
          return (
            <li key={e.id} className="rounded-md border bg-surface p-md shadow-card">
              <div className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{e.actor}</p>
                  <p className="text-body text-fg-secondary">{e.action}</p>
                  <p className="text-label text-fg-muted">
                    {e.entity} · {e.context ?? t("admin.preview.audit.contextNone")}
                  </p>
                  {e.summary ? <p className="mt-1 text-label text-fg-secondary">{e.summary}</p> : null}
                  <p className="mt-1 text-label text-fg-muted">{e.dateTime}</p>
                </div>
                <ExpandButton open={isOpen} label={toggleLabel(isOpen)} onClick={() => toggle(e.id)} />
              </div>
              {isOpen ? (
                <div className="mt-sm border-t pt-sm">
                  <Detail row={e} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <TablePagination
        {...slice}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </div>
  );
}

function DetailField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className={cn("break-words text-fg", mono && "font-mono text-label")}>{value ?? "—"}</dd>
    </div>
  );
}

function ExpandButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span aria-hidden="true" className={cn("text-body transition-transform", open && "rotate-180")}>
        ▾
      </span>
    </button>
  );
}
