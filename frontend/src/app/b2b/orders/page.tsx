import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrders, type OrderListRow } from "@/server/queries/execution";
import { PageHeader } from "@/features/sales/page-parts";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { OrderTable } from "@/features/execution/execution-lists";
import { ClipboardIcon, ActivityIcon, CheckIcon, WalletIcon } from "@/components/ui/icons";
import { formatMoney } from "@/features/commerce/constants";
import { commerceStance } from "@/lib/workspace/supply-side";

export const dynamic = "force-dynamic";

function countBy(rows: OrderListRow[], status: string) {
  return rows.filter((o) => o.status === status).length;
}

/**
 * Orders — confirmed commitments, from whichever seat the organization occupies.
 *
 * This page absorbs what used to read as two separate ideas ("my orders" and "my
 * purchases"): they are the same records, so there is one list with an explicit
 * perspective rather than two labels competing for the same rows.
 *
 *   Buyer seat    orders we PLACED lead — what we have committed to spend.
 *   Seller seat   orders placed WITH US lead — what we have committed to deliver.
 *
 * The seller tab has always existed here; the stance is what decides it opens
 * first. It stays gated on actually having such orders, so a business with none
 * never lands on an empty tab.
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
  const isSeller = commerceStance(org.orgType) === "seller";
  const leadsWithReceived = isSeller && showSellSide;
  const defaultView = leadsWithReceived ? "received" : "placed";
  const otherView = leadsWithReceived ? "placed" : "received";

  const requested = sp.view === otherView ? otherView : defaultView;
  const view = requested === "received" && !showSellSide ? "placed" : requested;
  const rows = view === "placed" ? placed : received;

  const totalValue = rows.reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  const label = (v: "placed" | "received") =>
    v === "placed" ? m.execution.order.placedHeading : m.execution.order.receivedHeading;
  const count = (v: "placed" | "received") => (v === "placed" ? placed.length : received.length);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        title={leadsWithReceived ? m.supply.orders.title : m.execution.order.title}
        subtitle={leadsWithReceived ? m.supply.orders.subtitle : m.execution.order.subtitle}
        count={rows.length}
      />

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
            current={view === defaultView ? "" : otherView}
            label={m.execution.order.title}
            tabs={[
              { value: "", label: label(defaultView), count: count(defaultView) },
              { value: otherView, label: label(otherView), count: count(otherView) },
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
