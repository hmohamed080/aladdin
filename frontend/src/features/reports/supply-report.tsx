import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import type { SupplySummary } from "@/server/queries/reports";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { TrendLine, DonutSplit, RankedBars, Funnel } from "@/components/ui/charts";
import { formatMoney } from "@/features/commerce/constants";
import { formatMonth, formatCompactMoney, formatPercent } from "@/lib/ui/format";
import type { SupplyVoice } from "@/lib/workspace/supply-side";
import {
  DemandIcon,
  FileTextIcon,
  ClipboardIcon,
  WalletIcon,
  PackageIcon,
  StorefrontIcon,
  TrendingUpIcon,
  ActivityIcon,
  BadgeCheckIcon,
} from "@/components/ui/icons";

const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
const ORDER_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"] as const;
const RFQ_STATUSES = ["submitted", "quoted", "closed", "cancelled"] as const;

function sum(rec: Record<string, number>) {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

/**
 * The supply-side half of Reports & Analytics.
 *
 * Built entirely from the existing chart system — `TrendLine`, `DonutSplit`,
 * `RankedBars`, `Funnel`, `StatTiles` — so a Distributor's report reads with the
 * same visual grammar as the Showroom report it sits beside. No new chart type,
 * no second charting approach.
 *
 * THE SAME HONESTY CONSTRAINTS AS THE BUYING REPORT
 * Every figure is an aggregate of records the caller can open and verify. There
 * are no targets, no forecasts, no period-over-period growth badges, and no
 * benchmark against "similar businesses" — nothing in the database produces any
 * of them.
 *
 * Three things the Distributor reference set shows that are absent here, each for
 * a concrete reason rather than a scoping preference:
 *   - Sales by GOVERNORATE on a map of Egypt. Organizations carry a `locality_id`
 *     with no locality table behind it and no coordinates anywhere, so the map
 *     would be drawn from nothing.
 *   - An AI "smart insight" recommending what to stock. There is no such model,
 *     and a recommendation is the last thing that should be faked.
 *   - Invoices, collections and average collection period. There is no
 *     receivables model in this repository at all.
 *
 * DELIBERATELY NOT FILTERED BY BRANCH
 * The branch on every commerce record is the BUYER's branch. A seller filtering
 * their own report by it would be reading someone else's depot, so the page does
 * not offer the control on this side rather than answering the question wrongly.
 */
export function SupplyReport({
  supply,
  voice,
  m,
  locale,
}: {
  supply: SupplySummary;
  voice: SupplyVoice;
  m: Messages;
  locale: Locale;
}) {
  const money = (v: number) => formatMoney(v, locale);
  const totalDemand = sum(supply.demand);
  const totalQuotes = sum(supply.quotations);
  const totalOrders = sum(supply.orders);

  return (
    <>
      <SectionTitle icon={<WalletIcon size={18} />}>{m.supply.section.performance}</SectionTitle>

      <StatTiles
        tiles={[
          {
            label: m.supply.tile.orderValue,
            value: formatCompactMoney(supply.orderValue, locale),
            Icon: WalletIcon,
            tone: "accent",
            hint: m.supply.tile.orderValueHint,
          },
          {
            label: m.supply.funnel.demand,
            value: totalDemand,
            Icon: DemandIcon,
            href: "/b2b/rfqs",
          },
          {
            label: m.supply.funnel.quoted,
            value: totalQuotes,
            Icon: FileTextIcon,
            tone: "info",
            href: "/b2b/quotations",
          },
          {
            label: m.supply.funnel.ordered,
            value: totalOrders,
            Icon: ClipboardIcon,
            tone: "success",
            href: "/b2b/orders",
          },
          {
            label: m.supply.tile.customers,
            value: supply.activeCustomers,
            Icon: StorefrontIcon,
            href: "/b2b/buyers",
          },
          {
            label: m.supply.acceptedValue,
            value: formatCompactMoney(supply.acceptedValue, locale),
            Icon: BadgeCheckIcon,
            tone: "success",
          },
        ]}
        /* Six tiles. As a grid at laptop width the money figures squeeze and
           truncate; as the shared rail each card holds its width and the row
           scrolls, and where all six fit no control is drawn. */
        layout="rail"
        railLabel={m.supply.section.performance}
      />

      <Card>
        <SectionTitle icon={<TrendingUpIcon size={18} />}>{m.supply.chart.valueTrend}</SectionTitle>
        <p className="mt-1 text-label text-fg-muted">{m.supply.chart.valueTrendHint}</p>
        <div className="mt-md">
          <TrendLine
            points={supply.trend.map((b) => ({ label: formatMonth(b.month, locale), value: b.value }))}
            emptyLabel={m.supply.empty.noOrders}
            ariaLabel={m.supply.chart.valueTrend}
            formatValue={(v) => formatCompactMoney(v, locale)}
          />
        </div>
      </Card>

      <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <SectionTitle icon={<ActivityIcon size={18} />}>{m.supply.chart.funnel}</SectionTitle>
          <p className="mt-1 text-label text-fg-muted">{m.supply.chart.funnelHint}</p>
          <div className="mt-md">
            <Funnel
              steps={[
                { label: m.supply.funnel.demand, value: totalDemand },
                { label: m.supply.funnel.quoted, value: totalQuotes },
                { label: m.supply.funnel.ordered, value: totalOrders },
              ]}
              emptyLabel={m.reports.noData}
              ofFirstLabel={(pct) =>
                m.reports.funnel.ofFirst.replace("{pct}", formatPercent(pct, locale))
              }
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<PackageIcon size={18} />}>{m.supply.chart.topProducts}</SectionTitle>
          {/* The one line in this whole report that differs between a
              Distributor, a Manufacturer and an Importer. */}
          <p className="mt-1 text-label text-fg-muted">{m.supply.voice[voice].topProductsHint}</p>
          <div className="mt-md">
            <DonutSplit
              slices={supply.topProducts.map((p) => ({ label: p.name, value: p.value }))}
              emptyLabel={m.supply.empty.noProductSales}
              ariaLabel={m.supply.chart.topProducts}
              centerLabel={m.reports.chart.total}
              formatValue={(v) => formatCompactMoney(v, locale)}
              formatShare={(p) => formatPercent(p, locale)}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<StorefrontIcon size={18} />}>{m.supply.chart.topCustomers}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              colored
              emptyLabel={m.supply.empty.noCustomers}
              items={supply.topCustomers.map((c) => ({
                label: c.name,
                value: c.value || c.orders,
                detail: money(c.value),
                // Value alone cannot tell a standing relationship from one large
                // order; the count is what separates them.
                meta:
                  c.orders === 1
                    ? m.directory.workedOrderOne
                    : m.directory.workedOrders.replace("{count}", String(c.orders)),
              }))}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<DemandIcon size={18} />}>{m.supply.chart.demandByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={RFQ_STATUSES.map((s) => ({
                label: m.commerce.rfqStatus[s],
                value: supply.demand[s] ?? 0,
              }))}
            />
          </div>
          {/* A draft RFQ belongs to whoever is writing it, so it never reaches
              this side — the status list above omits it rather than pinning a
              permanent zero to the chart. */}
        </Card>

        <Card>
          <SectionTitle icon={<FileTextIcon size={18} />}>
            {m.supply.chart.quotationsByStatus}
          </SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={QUOTE_STATUSES.map((s) => ({
                label: m.commerce.quotationStatus[s],
                value: supply.quotations[s] ?? 0,
              }))}
            />
          </div>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">
            {m.supply.awaitingDecisionValue}:{" "}
            <span dir="ltr" className="font-medium tabular-nums text-fg">
              {money(supply.awaitingDecisionValue)}
            </span>
          </p>
        </Card>

        <Card>
          <SectionTitle icon={<ClipboardIcon size={18} />}>{m.supply.chart.ordersByStatus}</SectionTitle>
          <div className="mt-md">
            <RankedBars
              emptyLabel={m.reports.noData}
              items={ORDER_STATUSES.map((s) => ({
                label: m.execution.orderStatus[s],
                value: supply.orders[s] ?? 0,
              }))}
            />
          </div>
          <p className="mt-md border-t pt-sm text-label text-fg-muted">
            {m.supply.tile.orderValue}:{" "}
            <span dir="ltr" className="font-medium tabular-nums text-fg">
              {money(supply.orderValue)}
            </span>
          </p>
        </Card>
      </div>
    </>
  );
}
