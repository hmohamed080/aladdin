import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  myOpenLeads,
  overdueFollowUps,
  followUpsDueToday,
  recentActivities,
  customerNameMap,
} from "@/server/queries/sales";
import { listRfqs, listQuotations, listSavedProducts } from "@/server/queries/commerce";
import { listOrders } from "@/server/queries/execution";
import { Card, StatePanel, SectionTitle } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { QuickActions } from "@/features/home/quick-actions";
import { RfqTable, QuotationTable } from "@/features/commerce/commerce-lists";
import { HomeFollowUpList, HomeLeadList, HomeActivityList, EmptyLine } from "@/features/sales/home-widgets";
import {
  AlertIcon,
  ClockIcon,
  TargetIcon,
  ActivityIcon,
  ShoppingBagIcon,
  InboxIcon,
  ClipboardIcon,
  BookmarkIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * The workspace dashboard.
 *
 * Buyer-first, because the Showroom/Dealer is this workspace's primary account and
 * its day starts on the purchasing side. The page composes from capabilities rather
 * than from an account type: a member who buys sees the purchasing panels, a member
 * who sells sees the pipeline panels, and someone who does both sees both — in that
 * order. Nothing renders a section the caller has no records or rights for.
 */
export default async function B2BHomePage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const branchId = org.activeBranchId;

  const caps = new Set(org.capabilities);
  const superUser = caps.has("org.manage");
  const has = (...keys: string[]) => superUser || keys.some((k) => caps.has(k));

  const buys = has("rfq.create", "order.create", "catalog.read", "quote.decide");
  const sells = has("sales.read", "sales.write", "sales.manage");

  const [requests, offers, orders, saved, overdue, dueToday, open, activities, custNames] =
    await Promise.all([
      buys ? listRfqs(supabase, org.organizationId, "requester") : Promise.resolve([]),
      buys ? listQuotations(supabase, org.organizationId, "requester") : Promise.resolve([]),
      buys ? listOrders(supabase, org.organizationId, "requester") : Promise.resolve([]),
      buys ? listSavedProducts(supabase, org.organizationId) : Promise.resolve([]),
      sells ? overdueFollowUps(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? followUpsDueToday(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? myOpenLeads(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? recentActivities(supabase, org.organizationId, branchId) : Promise.resolve([]),
      sells ? customerNameMap(supabase, org.organizationId) : Promise.resolve([]),
    ]);

  const custMap = Object.fromEntries(custNames);

  const openRequests = requests.filter((r) => r.status === "submitted" || r.status === "quoted");
  const newOffers = offers.filter((q) => q.status === "submitted");
  const activeOrders = orders.filter((o) => o.status === "confirmed" || o.status === "in_progress");

  // Tiles lead with whatever is waiting on the caller — an overdue follow-up or an
  // undecided offer outranks a total, because a total needs no action.
  const tiles: Tile[] = [];
  if (sells) {
    tiles.push({
      label: m.home.overdue,
      value: overdue.length,
      Icon: AlertIcon,
      tone: "danger",
      href: "/b2b/follow-ups",
    });
    tiles.push({
      label: m.home.dueToday,
      value: dueToday.length,
      Icon: ClockIcon,
      tone: "warning",
      href: "/b2b/follow-ups",
    });
  }
  if (buys) {
    tiles.push({
      label: m.home.tile.newOffers,
      value: newOffers.length,
      Icon: InboxIcon,
      tone: newOffers.length > 0 ? "accent" : "neutral",
      href: "/b2b/quotations",
    });
    tiles.push({
      label: m.home.tile.openRequests,
      value: openRequests.length,
      Icon: ShoppingBagIcon,
      href: "/b2b/rfqs",
    });
    tiles.push({
      label: m.home.tile.activeOrders,
      value: activeOrders.length,
      Icon: ClipboardIcon,
      tone: "info",
      href: "/b2b/orders",
    });
    tiles.push({
      label: m.home.tile.saved,
      value: saved.length,
      Icon: BookmarkIcon,
      href: "/b2b/saved",
    });
  }
  if (sells) {
    tiles.push({
      label: m.home.myOpenLeads,
      value: open.length,
      Icon: TargetIcon,
      tone: "accent",
      href: "/b2b/leads",
    });
  }

  const seeAll = (href: string, label: string) => (
    <Link href={href} className="text-label font-medium text-accent hover:underline">
      {label} →
    </Link>
  );

  return (
    <div className="flex flex-col gap-lg">
      <div className="min-w-0">
        <p className="truncate text-label text-fg-muted">
          {m.home.greeting} · {org.organizationName}
        </p>
        <h1 className="text-headline text-fg">{m.home.title}</h1>
      </div>

      {tiles.length > 0 ? <StatTiles tiles={tiles} /> : null}

      <QuickActions m={m} capabilities={org.capabilities} />

      {buys ? (
        <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <SectionTitle
              icon={<InboxIcon size={18} />}
              action={seeAll("/b2b/quotations", m.commerce.quotation.title)}
            >
              {m.home.latestOffers}
            </SectionTitle>
            <div className="mt-md">
              <QuotationTable
                quotations={offers.slice(0, 5)}
                perspective="requester"
                locale={locale}
                m={m}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle
              icon={<ShoppingBagIcon size={18} />}
              action={seeAll("/b2b/rfqs", m.commerce.rfq.title)}
            >
              {m.home.activeRequests}
            </SectionTitle>
            <div className="mt-md">
              <RfqTable rfqs={openRequests.slice(0, 5)} perspective="requester" locale={locale} m={m} />
            </div>
          </Card>
        </div>
      ) : null}

      {sells ? (
        <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <SectionTitle
              icon={<AlertIcon size={18} />}
              action={seeAll("/b2b/follow-ups", m.followUps.title)}
            >
              {m.home.overdue}
            </SectionTitle>
            <div className="mt-md">
              {overdue.length === 0 ? (
                <EmptyLine>{m.home.nothingDue}</EmptyLine>
              ) : (
                <HomeFollowUpList items={overdue} tone="danger" />
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle icon={<TargetIcon size={18} />} action={seeAll("/b2b/leads", m.leads.title)}>
              {m.home.myOpenLeads}
            </SectionTitle>
            <div className="mt-md">
              {open.length === 0 ? (
                <EmptyLine>{m.home.noOpenLeads}</EmptyLine>
              ) : (
                <HomeLeadList items={open} customerNames={custMap} />
              )}
            </div>
          </Card>

          <Card className="desktop:col-span-2">
            <SectionTitle icon={<ActivityIcon size={18} />}>{m.home.recentActivity}</SectionTitle>
            <div className="mt-md">
              {activities.length === 0 ? (
                <StatePanel icon={<ActivityIcon size={20} />} title={m.home.noActivity} body={m.home.startHint} />
              ) : (
                <HomeActivityList items={activities} />
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
