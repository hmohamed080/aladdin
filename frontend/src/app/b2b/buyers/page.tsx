import Link from "next/link";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { customerOrganizations } from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { CustomerNetworkTable } from "@/features/directory/customer-table";
import { formatCompactMoney } from "@/lib/ui/format";
import {
  StorefrontIcon,
  ReceiptIcon,
  DemandIcon,
  WalletIcon,
  LandmarkIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Customers & showrooms — the businesses that buy from this organization.
 *
 * WHY THIS IS NOT THE INSTITUTIONS DIRECTORY WITH A DIFFERENT TITLE
 * `/b2b/institutions` answers "who exists on Aladdin that I could sell to". This
 * answers "who actually works with me, and how". They read different sources —
 * one a public projection, the other the caller's own commerce records — and only
 * the second can rank a customer, show a relationship, or tell a seller who has
 * gone quiet. Both are useful; a seller needs the second one daily and the first
 * one occasionally, which is why the directory is a link at the bottom rather
 * than the page.
 *
 * WHY IT IS NOT A CRM
 * `/b2b/customers` already IS the CRM — a private book of customer records a
 * salesperson creates and owns, with leads and follow-ups behind it. This page
 * creates nothing. Every row here is derived from records that already exist, and
 * a business appears the moment it sends a request and never has to be typed in.
 * Forking business identity by letting a seller create a "customer" record for a
 * business that already has its own Organization is exactly what the account model
 * forbids.
 *
 * PRIVACY
 * Nothing here is a disclosure about the customer. Every figure counts records the
 * caller is a party to, and would read zero for any other viewer. See
 * `customerOrganizations` for the boundary in detail.
 */
export default async function CustomersNetworkPage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const rows = await customerOrganizations(supabase, org.organizationId);

  const ordering = rows.filter((c) => c.orders > 0).length;
  const totalValue = rows.reduce((s, c) => s + c.orderValue, 0);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        title={m.supply.customers.title}
        subtitle={m.supply.customers.subtitle}
        count={rows.length}
      />

      <StatTiles
        tiles={[
          {
            label: m.supply.customers.stat.total,
            value: rows.length,
            Icon: StorefrontIcon,
            tone: "accent",
          },
          {
            label: m.supply.customers.stat.ordering,
            value: ordering,
            Icon: ReceiptIcon,
            tone: "success",
          },
          {
            // The gap between "asked us" and "bought from us" is the one number on
            // this page a seller can act on today.
            label: m.supply.customers.stat.requesting,
            value: rows.length - ordering,
            Icon: DemandIcon,
            tone: rows.length - ordering > 0 ? "warning" : "neutral",
          },
          {
            label: m.supply.customers.stat.value,
            value: formatCompactMoney(totalValue, locale),
            Icon: WalletIcon,
            href: "/b2b/reports",
          },
        ]}
      />

      <CustomerNetworkTable
        rows={rows}
        m={m}
        locale={locale}
        emptyTitle={m.supply.customers.empty}
        emptyBody={m.supply.customers.emptyBody}
      />

      <p className="text-label text-fg-muted">{m.supply.customers.scopeNote}</p>

      {/* Finding NEW customers is a directory question, and the workspace already
          has a directory for it. Linking there beats duplicating it here. */}
      <Card>
        <SectionTitle icon={<LandmarkIcon size={18} />}>{m.supply.customers.findMore}</SectionTitle>
        <p className="mt-1 text-body text-fg-secondary">{m.supply.customers.findMoreBody}</p>
        <Link
          href="/b2b/institutions"
          className="mt-md inline-block text-label font-medium text-accent hover:underline"
        >
          {m.institutions.title} →
        </Link>
      </Card>
    </div>
  );
}
