import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listRfqs, type RfqListRow } from "@/server/queries/commerce";
import { PageHeader } from "@/features/sales/page-parts";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { RfqTable } from "@/features/commerce/commerce-lists";
import { ShoppingBagIcon, ClockIcon, ReceiptIcon, CheckIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

function countBy(rows: RfqListRow[], status: string) {
  return rows.filter((r) => r.status === status).length;
}

/**
 * Purchase Requests — the prices this business has asked suppliers for.
 *
 * The buying side is the default view and the page's identity, because that is a
 * showroom's daily work. Selling ("requests suppliers sent US") is a second tab
 * that only appears for an organization that can actually respond to one — a pure
 * buyer never sees an empty half of a page it has no role in.
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

  const view = canRespond && sp.view === "received" ? "received" : "sent";

  const [sent, received] = await Promise.all([
    listRfqs(supabase, org.organizationId, "requester"),
    canRespond ? listRfqs(supabase, org.organizationId, "supplier") : Promise.resolve([]),
  ]);

  const rows = view === "sent" ? sent : received;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.commerce.rfq.title} subtitle={m.commerce.rfq.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.commerce.rfq.stat.open, value: countBy(rows, "submitted"), Icon: ClockIcon, tone: "warning" },
          { label: m.commerce.rfq.stat.quoted, value: countBy(rows, "quoted"), Icon: ReceiptIcon, tone: "accent" },
          { label: m.commerce.rfq.stat.closed, value: countBy(rows, "closed"), Icon: CheckIcon, tone: "success" },
          { label: m.commerce.rfq.stat.drafts, value: countBy(rows, "draft"), Icon: ShoppingBagIcon },
        ]}
      />

      <div>
        {canRespond ? (
          <TabLinks
            basePath="/b2b/rfqs"
            param="view"
            current={view === "sent" ? "" : "received"}
            label={m.commerce.rfq.title}
            tabs={[
              { value: "", label: m.commerce.rfq.sentHeading, count: sent.length },
              { value: "received", label: m.commerce.rfq.receivedHeading, count: received.length },
            ]}
          />
        ) : null}

        <RfqTable
          rfqs={rows}
          perspective={view === "sent" ? "requester" : "supplier"}
          locale={locale}
          m={m}
        />
      </div>
    </div>
  );
}
