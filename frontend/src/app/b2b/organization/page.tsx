import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrgMembers, listOrgInvitations } from "@/server/queries/organization";
import { listJoinRequests } from "@/server/queries/affiliation";
import { PageHeader } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { PeopleManager } from "@/features/organization/people-manager";
import { JoinRequests } from "@/features/organization/join-requests";

export const dynamic = "force-dynamic";

/**
 * Organization → People. The minimum in-product people management for the Pilot:
 * roster with role/branch scope, invite an employee, assign a capability preset,
 * assign branch scope, and see invitation status. Every mutation is a trusted RPC
 * gated on `org.members.manage`; this page only gates what CHROME renders.
 */
export default async function OrganizationPeoplePage() {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);

  const canManageMembers = org.capabilities.includes("org.members.manage");
  if (!canManageMembers) {
    return (
      <div className="flex flex-col gap-lg">
        <PageHeader title={m.org.title} subtitle={m.org.subtitle} />
        <StatePanel tone="warning" title={m.org.error.notAuthorized} body={m.org.noAccessBody} />
      </div>
    );
  }

  const [members, invitations, joinRequests, branchesRes] = await Promise.all([
    listOrgMembers(supabase, org.organizationId),
    listOrgInvitations(supabase, org.organizationId),
    listJoinRequests(supabase, org.organizationId),
    supabase
      .from("branches")
      .select("id, name")
      .eq("organization_id", org.organizationId)
      .is("deleted_at", null)
      .order("name"),
  ]);
  const branches = (branchesRes.data ?? []).map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="flex flex-col gap-xl pb-16 tablet:pb-0">
      <PageHeader title={m.org.title} subtitle={m.org.subtitle} />
      {/* People who asked to join THIS business (Sprint 13). Same surface, same
          org.members.manage capability — joining a business happens in one place. */}
      <JoinRequests requests={joinRequests} branches={branches} m={m} />
      <PeopleManager
        orgId={org.organizationId}
        members={members}
        invitations={invitations}
        branches={branches}
      />
    </div>
  );
}
