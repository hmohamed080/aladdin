"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { CustomerStatusBadge } from "@/features/sales/badges";
import type { CustomerRow } from "@/server/queries/sales";

/**
 * Responsive customers list: a semantic table on tablet+, stacked cards on
 * mobile. Phone is shown as stored; the normalized form is used only for dedup.
 */
export function CustomersTable({
  customers,
  branchNames,
  memberNames,
}: {
  customers: CustomerRow[];
  branchNames: Record<string, string>;
  memberNames: Record<string, string>;
}) {
  const { t } = useI18n();

  return (
    <>
      {/* Mobile cards */}
      <ul className="flex flex-col gap-sm tablet:hidden">
        {customers.map((c) => (
          <li key={c.id}>
            <Link
              href={`/b2b/customers/${c.id}`}
              className="block rounded-md border bg-surface p-md hover:border-strong"
            >
              <div className="flex items-center justify-between gap-md">
                <span className="text-body-lg font-medium text-fg">{c.display_name}</span>
                <CustomerStatusBadge status={c.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-md gap-y-0.5 text-label text-fg-secondary">
                <span>{c.primary_phone ?? "—"}</span>
                <span>{c.branch_id ? branchNames[c.branch_id] ?? "—" : t("common.none")}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Tablet+ table */}
      <div className="hidden overflow-x-auto tablet:block">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b text-start text-label text-fg-muted">
              <th scope="col" className="px-3 py-2 text-start">{t("customers.name")}</th>
              <th scope="col" className="px-3 py-2 text-start">{t("customers.type")}</th>
              <th scope="col" className="px-3 py-2 text-start">{t("customers.phone")}</th>
              <th scope="col" className="px-3 py-2 text-start">{t("customers.branch")}</th>
              <th scope="col" className="px-3 py-2 text-start">{t("customers.assignee")}</th>
              <th scope="col" className="px-3 py-2 text-start">{t("customers.status")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b hover:bg-surface-2">
                <td className="px-3 py-2">
                  <Link href={`/b2b/customers/${c.id}`} className="text-fg hover:text-accent">
                    {c.display_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-fg-secondary">
                  {c.customer_type === "company" ? t("customers.typeCompany") : t("customers.typeIndividual")}
                </td>
                <td className="px-3 py-2 font-mono text-fg-secondary">{c.primary_phone ?? "—"}</td>
                <td className="px-3 py-2 text-fg-secondary">
                  {c.branch_id ? branchNames[c.branch_id] ?? "—" : t("common.none")}
                </td>
                <td className="px-3 py-2 text-fg-secondary">
                  {c.assigned_membership_id ? memberNames[c.assigned_membership_id] ?? "—" : t("common.unassigned")}
                </td>
                <td className="px-3 py-2">
                  <CustomerStatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
