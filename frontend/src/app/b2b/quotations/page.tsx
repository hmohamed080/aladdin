import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listQuotations, type QuotationListRow } from "@/server/queries/commerce";
import { commerceStance } from "@/lib/workspace/supply-side";
import { formatMoney } from "@/features/commerce/constants";
import { formatCompactMoney, formatPercent } from "@/lib/ui/format";
import { PageHeader } from "@/components/ui/workspace-layout";
import { TabLinks, StatTiles } from "@/components/ui/stat-tiles";
import { WorkPane, Panel, PanelRow } from "@/components/ui/workspace-layout";
import { DonutSplit } from "@/components/ui/charts";
import { QuotationTable } from "@/features/commerce/commerce-lists";
import { InboxIcon, ClockIcon, CheckIcon, XIcon, WalletIcon, FileTextIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

function countBy(rows: QuotationListRow[], status: string) {
  return rows.filter((q) => q.status === status).length;
}

function valueOf(rows: QuotationListRow[], status: string) {
  return rows.filter((q) => q.status === status).reduce((s, q) => s + Number(q.total ?? 0), 0);
}

/**
 * Quotations — ONE module, read from whichever seat the organization occupies.
 *
 *   Buyer seat    "Incoming offers" — prices distributors quoted back to us, and
 *                 our job is to compare and DECIDE.
 *   Seller seat   "Quotations" — prices we have sent out, and our job is to see
 *                 which are still undecided and what they are worth.
 *
 * The same status means opposite things in the two seats, which is why the tiles
 * are not shared verbatim: `submitted` on the buying side is "waiting on YOUR
 * decision" (actionable), and on the selling side it is "waiting on THEIRS"
 * (not actionable, but it is the money at stake). Labelling both "Awaiting"
 * would tell one of the two seats to do something it cannot do.
 *
 * Route, query, table component and capability gate are all unchanged between the
 * seats. Nothing here is duplicated per organization type.
 */
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const canQuote =
    org.capabilities.includes("quote.submit") ||
    org.capabilities.includes("rfq.respond") ||
    org.capabilities.includes("org.manage");

  const leadsWithSent = commerceStance(org.orgType) === "seller" && canQuote;
  const defaultView = leadsWithSent ? "sent" : "received";
  const otherView = leadsWithSent ? "received" : "sent";

  const requested = sp.view === otherView ? otherView : defaultView;
  const view = requested === "sent" && !canQuote ? "received" : requested;

  const [received, sent] = await Promise.all([
    listQuotations(supabase, org.organizationId, "requester"),
    canQuote ? listQuotations(supabase, org.organizationId, "supplier") : Promise.resolve([]),
  ]);

  const rows = view === "received" ? received : sent;
  const onSent = view === "sent";

  const label = (v: "sent" | "received") =>
    v === "sent" ? m.commerce.quotation.sentHeading : m.commerce.quotation.receivedHeading;
  const count = (v: "sent" | "received") => (v === "sent" ? sent.length : received.length);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        Icon={leadsWithSent ? FileTextIcon : InboxIcon}
        title={leadsWithSent ? m.supply.quotations.title : m.commerce.quotation.title}
        subtitle={leadsWithSent ? m.supply.quotations.subtitle : m.commerce.quotation.subtitle}
        count={rows.length}
        toolbar={
          <Link
            href="/b2b/reports"
            className="text-label font-medium text-accent hover:underline"
          >
            {m.home.openReports} →
          </Link>
        }
      />

      <StatTiles
        layout="strip"
        tiles={[
          {
            label: onSent ? m.supply.tile.awaitingDecision : m.commerce.quotation.stat.awaiting,
            value: countBy(rows, "submitted"),
            Icon: ClockIcon,
            tone: "warning",
            hint: onSent
              ? // The number that matters on a seller's undecided pile is not how
                // many there are but how much is riding on them.
                formatCompactMoney(valueOf(rows, "submitted"), locale)
              : m.commerce.quotation.stat.awaitingHint,
          },
          {
            label: m.commerce.quotation.stat.accepted,
            value: countBy(rows, "accepted"),
            Icon: CheckIcon,
            tone: "success",
            hint: onSent ? formatMoney(valueOf(rows, "accepted"), locale) : undefined,
          },
          {
            label: m.commerce.quotation.stat.rejected,
            value: countBy(rows, "rejected"),
            Icon: XIcon,
            tone: "danger",
          },
          onSent
            ? {
                label: m.supply.acceptedValue,
                value: formatCompactMoney(valueOf(rows, "accepted"), locale),
                Icon: WalletIcon,
                tone: "accent",
              }
            : {
                label: m.commerce.quotation.stat.total,
                value: rows.length,
                Icon: InboxIcon,
                tone: "accent",
              },
        ]}
      />

      <WorkPane
        asideWidth="wide"
        aside={
          /* The reference puts a status donut and a short ranking beside its
             commercial tables. Both are honest here because both are read from
             the rows already on screen — no second query, and nothing that is
             not already in the list below. */
          <>
            <Panel title={m.supply.chart.quotationsByStatus} Icon={FileTextIcon}>
              <DonutSplit
                slices={QUOTATION_STATUSES.map((s) => ({
                  label: m.commerce.quotationStatus[s],
                  value: countBy(rows, s),
                }))}
                emptyLabel={m.reports.noData}
                ariaLabel={m.supply.chart.quotationsByStatus}
                centerLabel={m.commerce.quotation.stat.total}
                formatValue={(v) => String(v)}
                formatShare={(pct) => formatPercent(pct, locale)}
              />
            </Panel>

            {onSent ? (
              <Panel title={m.supply.acceptedValue} Icon={WalletIcon}>
                <PanelRow
                  label={m.commerce.quotationStatus.accepted}
                  value={formatMoney(valueOf(rows, "accepted"), locale)}
                  tone="success"
                />
                <PanelRow
                  label={m.commerce.quotationStatus.submitted}
                  value={formatMoney(valueOf(rows, "submitted"), locale)}
                  tone="warning"
                />
              </Panel>
            ) : null}
          </>
        }
      >
        {canQuote ? (
          <TabLinks
            basePath="/b2b/quotations"
            param="view"
            current={view === defaultView ? "" : otherView}
            label={m.commerce.quotation.title}
            tabs={[
              { value: "", label: label(defaultView), count: count(defaultView) },
              { value: otherView, label: label(otherView), count: count(otherView) },
            ]}
          />
        ) : null}

        <QuotationTable
          quotations={rows}
          perspective={onSent ? "supplier" : "requester"}
          locale={locale}
          m={m}
        />
      </WorkPane>
    </div>
  );
}

/** The four states a quotation can be in — the donut may not invent a fifth. */
const QUOTATION_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
