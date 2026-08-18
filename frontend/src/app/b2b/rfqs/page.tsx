import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listRfqs, type RfqListRow } from "@/server/queries/commerce";
import { commerceStance, supplyVoice } from "@/lib/workspace/supply-side";
import { PageHeader } from "@/components/ui/workspace-layout";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { WorkPane, Panel } from "@/components/ui/workspace-layout";
import { DonutSplit } from "@/components/ui/charts";
import { formatPercent } from "@/lib/ui/format";
import { RfqTable } from "@/features/commerce/commerce-lists";
import {
  ShoppingBagIcon,
  ClockIcon,
  ReceiptIcon,
  CheckIcon,
  DemandIcon,
  FileTextIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

function countBy(rows: RfqListRow[], status: string) {
  return rows.filter((r) => r.status === status).length;
}

/**
 * Requests for price — ONE module, read from whichever seat the organization
 * occupies.
 *
 * Both directions have always lived on this route, because an RFQ names both
 * parties and there is exactly one record to open. What changes with the stance is
 * which direction LEADS:
 *
 *   Buyer seat (Showroom, contractor, design office)
 *     "Purchase requests" — prices we have asked distributors for. Requests sent
 *     TO us are the second tab, and only for an organization that can answer one.
 *
 *   Seller seat (Distributor, Manufacturer, Importer)
 *     "Incoming demand" — businesses asking US to price and supply. This is the
 *     work queue, and `submitted` is its urgent bucket: a request nobody has
 *     priced, with a competitor already looking at it. What we ask others for is
 *     still here, one tab away, because a distributor buys raw materials too.
 *
 * Nothing is duplicated to achieve that: same route, same query, same table
 * component, same capability gate. The stance chooses a default tab and a set of
 * words.
 *
 * WHAT THIS IS NOT
 * The Distributor reference set calls this surface "New Opportunities" and shows a
 * matching engine over a demand marketplace — competitor counts, match scores,
 * expiry countdowns, saved opportunities. No such model exists in this repository,
 * so none of it is invented here. What IS real is the RFQ addressed to this
 * organization, and that is what the module shows.
 */
export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const canRespond =
    org.capabilities.includes("rfq.respond") ||
    org.capabilities.includes("quote.submit") ||
    org.capabilities.includes("org.manage");

  // A supply-side organization leads with incoming demand — but only if this
  // caller can actually act on it. A distributor's branch salesperson without
  // `rfq.respond` would otherwise land on a queue they cannot answer, which is
  // the dead-end the capability model exists to prevent.
  const leadsWithDemand = commerceStance(org.orgType) === "seller" && canRespond;
  const defaultView = leadsWithDemand ? "received" : "sent";
  const otherView = leadsWithDemand ? "sent" : "received";

  // Only `canRespond` unlocks the received side, in either direction of default.
  const requested = sp.view === otherView ? otherView : defaultView;
  const view = requested === "received" && !canRespond ? "sent" : requested;

  const [sent, received] = await Promise.all([
    listRfqs(supabase, org.organizationId, "requester"),
    canRespond ? listRfqs(supabase, org.organizationId, "supplier") : Promise.resolve([]),
  ]);

  const rows = view === "sent" ? sent : received;
  const onDemand = view === "received";

  const label = (v: "sent" | "received") =>
    v === "sent" ? m.commerce.rfq.sentHeading : m.commerce.rfq.receivedHeading;
  const count = (v: "sent" | "received") => (v === "sent" ? sent.length : received.length);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        Icon={leadsWithDemand ? DemandIcon : ShoppingBagIcon}
        title={leadsWithDemand ? m.supply.demand.title : m.commerce.rfq.title}
        subtitle={
          leadsWithDemand
            ? m.supply.voice[supplyVoice(org.orgType)].demandSubtitle
            : m.commerce.rfq.subtitle
        }
        count={rows.length}
        toolbar={
          <Link href="/b2b/quotations" className="text-label font-medium text-accent hover:underline">
            {leadsWithDemand ? m.supply.quotations.title : m.commerce.quotation.title} →
          </Link>
        }
      />

      {/* The tiles describe the VIEW, not the module. On the demand side
          `submitted` means "waiting for your price" and is the only number with a
          clock on it; on the buying side the same status means "sent, waiting" and
          is merely informational. Reusing one label for both would make the
          urgent bucket unreadable in one of the two seats. */}
      <StatTiles
        layout="strip"
        tiles={[
          {
            label: onDemand ? m.supply.tile.awaitingResponse : m.commerce.rfq.stat.open,
            value: countBy(rows, "submitted"),
            Icon: onDemand ? DemandIcon : ClockIcon,
            tone: onDemand && countBy(rows, "submitted") > 0 ? "danger" : "warning",
          },
          {
            label: m.commerce.rfq.stat.quoted,
            value: countBy(rows, "quoted"),
            Icon: ReceiptIcon,
            tone: "accent",
          },
          {
            label: m.commerce.rfq.stat.closed,
            value: countBy(rows, "closed"),
            Icon: CheckIcon,
            tone: "success",
          },
          // A draft belongs to whoever is WRITING the request, so it only exists
          // on the buying side. Showing "Drafts: 0" on a demand queue would
          // describe a state the seller can never reach.
          ...(onDemand
            ? []
            : [
                {
                  label: m.commerce.rfq.stat.drafts,
                  value: countBy(rows, "draft"),
                  Icon: ShoppingBagIcon,
                },
              ]),
        ]}
      />

      <WorkPane
        aside={
          <>
            <Panel title={m.supply.chart.demandByStatus} Icon={DemandIcon}>
              <DonutSplit
                slices={RFQ_STATUSES.map((s) => ({
                  label: m.commerce.rfqStatus[s],
                  value: countBy(rows, s),
                }))}
                emptyLabel={m.reports.noData}
                ariaLabel={m.supply.chart.demandByStatus}
                centerLabel={onDemand ? m.supply.demand.title : m.commerce.rfq.title}
                formatValue={(v) => String(v)}
                formatShare={(pct) => formatPercent(pct, locale)}
              />
            </Panel>

            {onDemand ? (
              /* The reference's "how opportunities work" panel, pointed at the
                 real mechanism: demand arrives because products are published,
                 and it is answered with a quotation. Two links, both to routes
                 that exist. */
              <Panel title={m.supply.action.quotations} Icon={FileTextIcon}>
                <p className="text-label text-fg-secondary">{m.supply.action.quotationsBody}</p>
                <div className="mt-sm flex flex-col gap-1 border-t pt-sm">
                  <Link
                    href="/b2b/quotations"
                    className="text-label font-medium text-accent hover:underline"
                  >
                    {m.supply.quotations.title} →
                  </Link>
                  <Link
                    href="/b2b/products"
                    className="text-label font-medium text-accent hover:underline"
                  >
                    {m.supply.products.title} →
                  </Link>
                </div>
              </Panel>
            ) : null}
          </>
        }
      >
        {canRespond ? (
          <TabLinks
            basePath="/b2b/rfqs"
            param="view"
            current={view === defaultView ? "" : otherView}
            label={m.commerce.rfq.title}
            tabs={[
              { value: "", label: label(defaultView), count: count(defaultView) },
              { value: otherView, label: label(otherView), count: count(otherView) },
            ]}
          />
        ) : null}

        <RfqTable rfqs={rows} perspective={onDemand ? "supplier" : "requester"} locale={locale} m={m} />
      </WorkPane>
    </div>
  );
}

/** The states an RFQ can be in — the donut may not invent one. */
const RFQ_STATUSES = ["draft", "submitted", "quoted", "closed", "cancelled"] as const;
