import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listCustomers, branchNameMap, memberNameMap } from "@/server/queries/sales";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StatePanel } from "@/components/ui/primitives";
import { UsersIcon } from "@/components/ui/icons";
import { CustomersTable } from "@/features/sales/customers-table";
import { CustomerFilters } from "@/features/sales/customer-filters";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; branch?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const branchId = sp.branch ?? org.activeBranchId ?? undefined;
  const status = sp.status === "archived" ? "archived" : sp.status === "active" ? "active" : undefined;

  const [customers, branchNames, memberNames] = await Promise.all([
    listCustomers(supabase, {
      orgId: org.organizationId,
      branchId: branchId ?? undefined,
      status,
      search: sp.q,
    }),
    branchNameMap(supabase, org.organizationId),
    memberNameMap(supabase, org.organizationId),
  ]);

  const canWrite = org.canManageSales || org.capabilities.includes("sales.write");

  return (
    <div className="pb-16 tablet:pb-0">
      <PageHeader
        Icon={UsersIcon}
        title={m.customers.title}
        subtitle={m.customers.subtitle}
        count={customers.length}
        action={canWrite ? { href: "/b2b/customers/new", label: m.customers.new } : undefined}
      />

      <CustomerFilters
        branches={org.branches}
        defaults={{ q: sp.q ?? "", status: sp.status ?? "", branch: sp.branch ?? "" }}
      />

      {customers.length === 0 ? (
        <StatePanel icon={<UsersIcon size={20} />} title={m.customers.empty} body={m.customers.emptyHint} />
      ) : (
        <CustomersTable
          customers={customers}
          branchNames={Object.fromEntries(branchNames)}
          memberNames={Object.fromEntries(memberNames)}
        />
      )}
    </div>
  );
}
