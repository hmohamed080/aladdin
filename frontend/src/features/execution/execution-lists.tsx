"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Card, StatePanel } from "@/components/ui/primitives";
import { PackageIcon, ActivityIcon } from "@/components/ui/icons";
import { OrderStatusBadge, ProjectStatusBadge } from "@/features/execution/badges";
import { formatDate } from "@/lib/ui/format";
import { formatMoney } from "@/features/commerce/constants";
import type { OrderListRow, ProjectListRow } from "@/server/queries/execution";

/** Order list. `perspective` picks which counterparty name to emphasize. */
export function OrderList({
  orders,
  perspective,
  locale,
}: {
  orders: OrderListRow[];
  perspective: "requester" | "supplier";
  locale: Locale;
}) {
  const { t } = useI18n();
  if (orders.length === 0) {
    return (
      <StatePanel
        icon={<PackageIcon size={22} />}
        title={t(`execution.order.empty.${perspective}Title`)}
        body={t(`execution.order.empty.${perspective}Body`)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-sm">
      {orders.map((o) => (
        <Link key={o.id} href={`/b2b/orders/${o.id}`} className="block">
          <Card pad="sm" className="transition-colors hover:border-strong">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{o.title}</p>
                <p className="mt-0.5 text-label text-fg-muted">
                  {perspective === "requester"
                    ? t("execution.order.withSupplier", { supplier: o.supplier_name ?? "—" })
                    : t("execution.order.withRequester", { requester: o.requester_name ?? "—" })}
                  {" · "}
                  {t("execution.order.itemCount", { count: o.item_count ?? 0 })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <OrderStatusBadge status={o.status ?? "confirmed"} />
                <span className="text-label font-medium tabular-nums text-fg" dir="ltr">
                  {formatMoney(o.total, locale)}
                </span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** Project list. `perspective` = executing (mine) or requester (counterparty). */
export function ProjectList({
  projects,
  perspective,
  locale,
}: {
  projects: ProjectListRow[];
  perspective: "executing" | "requester";
  locale: Locale;
}) {
  const { t } = useI18n();
  if (projects.length === 0) {
    return (
      <StatePanel
        icon={<ActivityIcon size={22} />}
        title={t(`execution.project.empty.${perspective}Title`)}
        body={t(`execution.project.empty.${perspective}Body`)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-sm">
      {projects.map((p) => (
        <Link key={p.id} href={`/b2b/projects/${p.id}`} className="block">
          <Card pad="sm" className="transition-colors hover:border-strong">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{p.title}</p>
                <p className="mt-0.5 text-label text-fg-muted">
                  {perspective === "executing"
                    ? t("execution.project.forRequester", { requester: p.requester_name ?? "—" })
                    : t("execution.project.byExecutor", { executor: p.executing_name ?? "—" })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <ProjectStatusBadge status={p.status ?? "planned"} />
                {p.target_date ? (
                  <span className="text-label text-fg-muted">{formatDate(p.target_date, locale)}</span>
                ) : null}
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
