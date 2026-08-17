import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { listOrgMembers, listOrgInvitations } from "@/server/queries/organization";
import { listJoinRequests } from "@/server/queries/affiliation";
import { PageHeader } from "@/features/sales/page-parts";
import { StatePanel } from "@/components/ui/primitives";
import { StatTiles } from "@/components/ui/stat-tiles";
import { PeopleManager } from "@/features/organization/people-manager";
import { JoinRequests } from "@/features/organization/join-requests";
import { UsersIcon, BadgeCheckIcon, ClockIcon, LandmarkIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Organization → People. The minimum in-product people management for the Pilot:
 * roster with role/branch scope, invite an employee, assign a capability preset,
 * assign branch scope, and see invitation status. Every mutation is a trusted RPC
 * gated on `org.members.manage`; this page only gates what CHROME renders.
 *
 * This surface is deliberately identical for every organization type. A
 * Distributor's sales team and a Showroom's are the same thing — people with
 * capabilities and branch scope — and the supply-side sprint added no fork here.
 *
 * WHAT THE REFERENCE ASKS FOR AND WHY IT IS NOT HERE
 * The Distributor reference's "المندوبين" screen ranks each representative
 * against a monthly sales TARGET, with an achievement percentage, a leaderboard
 * and inactivity alerts. There is no target, quota, commission or per-person
 * revenue attribution model in this repository. Building the screen would mean
 * inventing every number on it, and a leaderboard built from fiction is worse
 * than no leaderboard — it would be used to manage real people. The tiles below
 * report only what the roster genuinely knows.
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

      {/* Every figure is counted from the roster already loaded above — no extra
          read, and nothing here that the records do not already state. */}
      <StatTiles
        tiles={[
          { label: m.org.stat.members, value: members.length, Icon: UsersIcon, tone: "accent" },
          {
            label: m.org.stat.active,
            value: members.filter((mem) => mem.status === "active").length,
            Icon: BadgeCheckIcon,
            tone: "success",
          },
          {
            label: m.org.stat.pending,
            value: invitations.filter((i) => i.status === "pending").length,
            Icon: ClockIcon,
            tone: invitations.some((i) => i.status === "pending") ? "warning" : "neutral",
            hint: m.org.stat.pendingHint,
          },
          { label: m.org.stat.branches, value: branches.length, Icon: LandmarkIcon },
        ]}
      />
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
