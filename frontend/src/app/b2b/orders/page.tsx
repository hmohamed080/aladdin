import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrders, type OrderListRow } from "@/server/queries/execution";
import { PageHeader } from "@/features/sales/page-parts";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { OrderTable } from "@/features/execution/execution-lists";
import { ClipboardIcon, ActivityIcon, CheckIcon, WalletIcon } from "@/components/ui/icons";
import { formatMoney } from "@/features/commerce/constants";

export const dynamic = "force-dynamic";

function countBy(rows: OrderListRow[], status: string) {
  return rows.filter((o) => o.status === status).length;
}

/**
 * Orders & Purchases — confirmed commitments, buying side first.
 *
 * This page absorbs what used to read as two separate ideas ("my orders" and "my
 * purchases"): for a showroom they are the same records, so there is one list with
 * an explicit perspective rather than two labels competing for the same rows.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const [placed, received] = await Promise.all([
    listOrders(supabase, org.organizationId, "requester"),
    listOrders(supabase, org.organizationId, "supplier"),
  ]);

  // Only offer the selling tab to a business that actually receives orders.
  const showSellSide = received.length > 0;
  const view = showSellSide && sp.view === "received" ? "received" : "placed";
  const rows = view === "placed" ? placed : received;

  const totalValue = rows.reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.execution.order.title} subtitle={m.execution.order.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.execution.order.stat.confirmed, value: countBy(rows, "confirmed"), Icon: ClipboardIcon, tone: "info" },
          { label: m.execution.order.stat.inProgress, value: countBy(rows, "in_progress"), Icon: ActivityIcon, tone: "accent" },
          { label: m.execution.order.stat.completed, value: countBy(rows, "completed"), Icon: CheckIcon, tone: "success" },
          { label: m.execution.order.stat.value, value: formatMoney(totalValue, locale), Icon: WalletIcon },
        ]}
      />

      <div>
        {showSellSide ? (
          <TabLinks
            basePath="/b2b/orders"
            param="view"
            current={view === "placed" ? "" : "received"}
            label={m.execution.order.title}
            tabs={[
              { value: "", label: m.execution.order.placedHeading, count: placed.length },
              { value: "received", label: m.execution.order.receivedHeading, count: received.length },
            ]}
          />
        ) : null}

        <OrderTable
          orders={rows}
          perspective={view === "placed" ? "requester" : "supplier"}
          locale={locale}
          m={m}
        />
      </div>
    </div>
  );
}
