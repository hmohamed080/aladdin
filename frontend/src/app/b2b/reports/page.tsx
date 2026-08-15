import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  purchaseSummary,
  sellSummary,
  savedByCategory,
  topSuppliers,
} from "@/server/queries/reports";
import { PageHeader } from "@/features/sales/page-parts";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { Breakdown } from "@/components/ui/breakdown";
import { formatMoney } from "@/features/commerce/constants";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import {
  ShoppingBagIcon,
  InboxIcon,
  ClipboardIcon,
  WalletIcon,
  TruckIcon,
  BookmarkIcon,
  TrendingUpIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const RFQ_STATUSES = ["draft", "submitted", "quoted", "closed", "cancelled"] as const;
const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
const ORDER_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"] as const;

function sum(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

/**
 * Reports & Analytics.
 *
 * Every figure is an aggregate of records the caller can open — the same RLS-scoped
 * views that fill the module lists. There are deliberately no targets, forecasts or
 * growth percentages: nothing in the database produces them, and a fabricated trend
 * line is worse than no trend line in front of a client.
 */
export default async function ReportsPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const [purchase, sell, saved, suppliers] = await Promise.all([
    purchaseSummary(supabase, org.organizationId),
    sellSummary(supabase, org.organizationId),
    savedByCategory(supabase, org.organizationId),
    topSuppliers(supabase, org.organizationId),
  ]);

  const sells = sum(sell.quotesSent) > 0 || sell.ordersReceived > 0;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.reports.title} subtitle={m.reports.subtitle} />

      <StatTiles
        tiles={[
          {
            label: m.reports.stat.requests,
            value: sum(purchase.requests),
            Icon: ShoppingBagIcon,
            tone: "accent",
            href: "/b2b/rfqs",
          },
          {
            label: m.reports.stat.offers,
            value: sum(purchase.offers),
            Icon: InboxIcon,
            tone: "info",
            href: "/b2b/quotations",
          },
          {
            label: m.reports.stat.orders,
            value: sum(purchase.orders),
            Icon: ClipboardIcon,
            tone: "success",
            href: "/b2b/orders",
          },
          {
            label: m.reports.stat.spend,
            value: formatMoney(purchase.orderValue, locale),
            Icon: WalletIcon,
            hint: m.reports.stat.spendHint,
          },
        ]}
      />

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<ShoppingBagIcon size={18} />}>{m.reports.requestsByStatus}</SectionTitle>
          <div className="mt-md">
            <Breakdown
              emptyLabel={m.reports.noData}
              items={RFQ_STATUSES.map((s) => ({
                label: m.commerce.rfqStatus[s],
                value: purchase.requests[s] ?? 0,
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<InboxIcon size={18} />}>{m.reports.offersByStatus}</SectionTitle>
          <div className="mt-md">
            <Breakdown
              emptyLabel={m.reports.noData}
              items={QUOTE_STATUSES.map((s) => ({
                label: m.commerce.quotationStatus[s],
                value: purchase.offers[s] ?? 0,
              }))}
            />
          </div>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">
            {m.reports.acceptedValue}:{" "}
            <span dir="ltr" className="font-medium tabular-nums text-fg">
              {formatMoney(purchase.acceptedOfferValue, locale)}
            </span>
          </p>
        </Card>

        <Card>
          <SectionTitle icon={<TruckIcon size={18} />}>{m.reports.topSuppliers}</SectionTitle>
          <div className="mt-md">
            <Breakdown
              emptyLabel={m.reports.noSuppliers}
              items={suppliers.map((s) => ({
                label: s.name,
                value: s.value || s.orders,
                detail: formatMoney(s.value, locale),
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<ClipboardIcon size={18} />}>{m.reports.ordersByStatus}</SectionTitle>
          <div className="mt-md">
            <Breakdown
              emptyLabel={m.reports.noData}
              items={ORDER_STATUSES.map((s) => ({
                label: m.execution.orderStatus[s],
                value: purchase.orders[s] ?? 0,
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<BookmarkIcon size={18} />}>{m.reports.shortlistByCategory}</SectionTitle>
          <div className="mt-md">
            <Breakdown
              emptyLabel={m.reports.noShortlist}
              items={PRODUCT_CATEGORIES.map((c) => ({
                label: m.commerce.categories[c],
                value: saved[c] ?? 0,
              }))}
            />
          </div>
        </Card>

        {sells ? (
          <Card>
            <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.reports.sellSide}</SectionTitle>
            <div className="mt-md">
              <Breakdown
                emptyLabel={m.reports.noData}
                items={QUOTE_STATUSES.map((s) => ({
                  label: m.commerce.quotationStatus[s],
                  value: sell.quotesSent[s] ?? 0,
                }))}
              />
            </div>
            <p className="mt-md border-t pt-sm text-label text-fg-muted">
              {m.reports.ordersWon}:{" "}
              <span className="font-medium tabular-nums text-fg">{sell.ordersReceived}</span>
              {" · "}
              <span dir="ltr" className="font-medium tabular-nums text-fg">
                {formatMoney(sell.ordersReceivedValue, locale)}
              </span>
            </p>
          </Card>
        ) : null}
      </div>

      <p className="text-label text-fg-muted">{m.reports.scopeNote}</p>
    </div>
  );
}
