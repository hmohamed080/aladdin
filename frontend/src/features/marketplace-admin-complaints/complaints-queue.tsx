import Link from "next/link";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { TableScroll } from "@/features/admin/parts";
import { formatCount, formatDateTime, formatMoney } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import { COMPLAINT_STATES, type ComplaintList, type ComplaintState } from "./model";

type T = (key: string, vars?: Record<string, string | number>) => string;

const STATE_TONE: Record<ComplaintState, "warning" | "info" | "success" | "neutral"> = {
  open: "warning", under_review: "info", resolved: "success", dismissed: "neutral",
};

/** The payment-complaint queue: state tabs with counts, then one row per complaint linking to its detail page. Server-rendered. */
export function ComplaintsQueue({ list, active, locale, t, basePath }: { list: ComplaintList; active: ComplaintState; locale: Locale; t: T; basePath: string }) {
  return (
    <div className="flex flex-col gap-md" data-testid="complaints-queue">
      <nav className="flex flex-wrap gap-sm" aria-label={t("marketplaceComplaints.title")}>
        {COMPLAINT_STATES.map((state) => (
          <Link
            key={state}
            href={`${basePath}?state=${state}`}
            aria-current={state === active ? "page" : undefined}
            className={`rounded-pill border px-3 py-1 text-label ${state === active ? "bg-primary text-primary-foreground" : "bg-surface text-fg-secondary"}`}
          >
            {t(`marketplaceComplaints.tabs.${state}`)} ({formatCount(list.counts[state] ?? 0, locale)})
          </Link>
        ))}
      </nav>
      {list.items.length === 0 ? (
        <StatePanel tone="neutral" title={t("marketplaceComplaints.empty")} />
      ) : (
        <TableScroll>
              <thead>
                <tr className="border-b text-label text-fg-secondary">
                  {(["order", "seller", "buyer", "total", "paid", "reason", "filedBy", "filed", "receipts"] as const).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-medium">{t(`marketplaceComplaints.columns.${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.items.map((row) => (
                  <tr key={row.id} className="border-b last:border-0" data-testid="complaint-row">
                    <td className="px-3 py-2">
                      <Link className="font-medium text-accent underline-offset-2 hover:underline" href={`${basePath}/${row.id}`}>{row.order_number}</Link>
                      <div><Badge tone={STATE_TONE[row.state]}>{t(`marketplaceComplaints.states.${row.state}`)}</Badge></div>
                    </td>
                    <td className="px-3 py-2">{row.seller_name ?? "—"}</td>
                    <td className="px-3 py-2">{row.buyer_name ?? "—"}</td>
                    <td className="px-3 py-2">{formatMoney(row.total_egp, locale)}</td>
                    <td className="px-3 py-2">{formatMoney(row.paid_now_egp, locale)}</td>
                    <td className="px-3 py-2">{t(`marketplaceComplaints.reasons.${row.reason}`)}</td>
                    <td className="px-3 py-2">{t(`marketplaceComplaints.filedBy.${row.filed_by_role}`)}</td>
                    <td className="px-3 py-2">{formatDateTime(row.filed_at, locale)}</td>
                    <td className="px-3 py-2">{formatCount(row.receipts_count, locale)}</td>
                  </tr>
                ))}
              </tbody>
        </TableScroll>
      )}
    </div>
  );
}
