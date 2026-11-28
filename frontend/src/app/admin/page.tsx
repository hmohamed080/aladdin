import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { adminSummary } from "@/server/queries/admin";
import { loadOrganizationsDirectory, loadUsersDirectory } from "@/server/queries/admin-directory";
import { dashboardUserCards } from "@/lib/admin/dashboard-user-counts";
import { dashboardOrgCards } from "@/lib/admin/dashboard-org-counts";
import { previewDashboardExtras } from "@/server/queries/admin-preview";
import { createTranslator, getMessages } from "@/lib/i18n/translate";
import { formatCount } from "@/lib/ui/format";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { AdminHeader, DistList } from "@/features/admin/parts";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import {
  UsersIcon,
  TrendingUpIcon,
  ClockIcon,
  BadgeCheckIcon,
  XIcon,
  AlertIcon,
  BuildingIcon,
  ShieldIcon,
  HandshakeIcon,
} from "@/components/ui/icons";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * Dashboard — an operational command center, kept deliberately focused.
 *
 * Reads the SAME `adminSummary()` the real `/admin` dashboard uses, plus one
 * additional real read (`previewDashboardExtras()`, kept in the preview's own
 * query file so `adminSummary()` and the live dashboard stay untouched). Every
 * KPI card is a real count and behaves as a filter link into the surface that
 * owns that data — never a dead number.
 *
 * Phase 0D: the two distributions are Users by status and Organizations by
 * status (only states Aladdin supports, zeros included).
 *
 * Two things this page deliberately does NOT have, both explicit Product
 * Owner direction: the large Recent Activity list (Audit/each subject's own
 * Activity tab already own that surface), and — as of Phase 0C — a separate
 * "Needs attention" panel (Phase 0B had one; the Product Owner decided the
 * KPI/status cards above already communicate operational state on their
 * own, and a second panel repeating the same signal was noise, not signal).
 */
export default async function AdminPreviewDashboardPage() {
  await requireAdminRoute("/admin");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const [s, extras, tabs, orgTabs] = await Promise.all([
    adminSummary(supabase),
    previewDashboardExtras(supabase),
    // The same tab counts the Users directory shows, so each card equals the list it links to.
    loadUsersDirectory(supabase, { search: null, status: null, accountType: null, verification: null, governorate: null, page: 1, pageSize: 10, sort: "registered:desc" }),
    // The same tab counts the Organizations directory shows (approval), so each organization card equals the list it links to.
    loadOrganizationsDirectory(supabase, { search: null, status: null, orgType: null, page: 1, pageSize: 10, sort: "registered:desc" }),
  ]);

  const totalUsers = Object.values(s.usersByStatus).reduce((a, b) => a + b, 0);
  // Pending / Verified / Rejected are the Users directory's own tab counts (a dash when that read fails).
  const userCards = dashboardUserCards(tabs);
  const verifiedUsers = userCards.verified;
  const pendingUsers = userCards.pending;
  const suspendedUsers = s.usersByStatus.suspended ?? 0;
  // Organization APPROVAL cards are the directory's own tab counts (a dash when that read fails); the lifecycle distribution
  // below keeps showing the actual organizations.status values.
  const orgCards = dashboardOrgCards(orgTabs);
  // `orgsTotal` counts every stored organization, archived ones included; the Organizations directory
  // lists non-archived ones only. Say so on the tile instead of leaving the two numbers to disagree.
  const archivedOrgs = s.orgsByStatus.archived ?? 0;

  const cards = m.admin.preview.dashboard.cards;
  const tiles: Tile[] = [
    { label: cards.totalUsers, value: totalUsers, Icon: UsersIcon, href: "/admin/users" },
    {
      label: cards.newRegistrations,
      value: extras.newRegistrationsThisWeek,
      Icon: TrendingUpIcon,
      tone: "info",
      href: "/admin/users",
    },
    {
      label: cards.pendingVerification,
      value: pendingUsers,
      Icon: ClockIcon,
      tone: "warning",
      href: "/admin/users?status=pending",
    },
    {
      label: cards.verifiedApproved,
      value: verifiedUsers,
      Icon: BadgeCheckIcon,
      tone: "success",
      href: "/admin/users?status=verified",
    },
    {
      label: cards.rejected,
      value: userCards.rejected,
      Icon: XIcon,
      tone: "danger",
      href: "/admin/users?status=rejected",
    },
    {
      label: cards.suspendedUsers,
      value: suspendedUsers,
      Icon: AlertIcon,
      tone: "warning",
      href: "/admin/users?status=suspended",
    },
    {
      label: cards.organizations,
      value: orgCards.all,
      hint: archivedOrgs > 0 ? t("admin.preview.dashboard.cards.organizationsIncludesArchived", { n: formatCount(archivedOrgs, locale) }) : undefined,
      Icon: BuildingIcon,
      href: "/admin/organizations",
    },
    {
      label: cards.pendingOrgVerification,
      value: orgCards.pending,
      Icon: ClockIcon,
      tone: "warning",
      href: "/admin/organizations?status=pending",
    },
    {
      label: cards.pendingNetworkReferrals,
      value: extras.pendingReferralsTotal,
      Icon: HandshakeIcon,
      tone: "info",
      href: "/admin/review",
    },
    {
      label: cards.approvedOrgs,
      value: orgCards.approved,
      Icon: BadgeCheckIcon,
      tone: "success",
      href: "/admin/organizations?status=verified",
    },
    {
      label: cards.rejectedOrgs,
      value: orgCards.rejected,
      Icon: XIcon,
      tone: "danger",
      href: "/admin/organizations?status=rejected",
    },
    {
      label: cards.suspendedOrgs,
      value: orgCards.suspended,
      Icon: ShieldIcon,
      tone: "warning",
      href: "/admin/organizations?status=suspended",
    },
  ];

  // Every status Aladdin actually supports (the `user_status` / `org_status`
  // enums), in lifecycle order, INCLUDING those with no records yet — an absent
  // state reads as a real zero rather than a state that does not exist. Nothing
  // Aladdin does not model (no "Rejected" or "Blocked" account status) is invented.
  const statusLabels = m.admin.status as Record<string, string>;
  const USER_STATUSES = ["pending_verification", "active", "suspended", "deactivated"] as const;
  const ORG_STATUSES = ["draft", "pending_verification", "active", "suspended", "archived"] as const;
  const userStatusEntries = USER_STATUSES.map((k) => ({ label: statusLabels[k] ?? k, value: s.usersByStatus[k] ?? 0 }));
  const orgStatusEntries = ORG_STATUSES.map((k) => ({ label: statusLabels[k] ?? k, value: s.orgsByStatus[k] ?? 0 }));

  return (
    <div className="flex flex-col gap-xl">
      <AdminHeader locale={locale} title={m.admin.preview.dashboard.title} subtitle={m.admin.preview.dashboard.subtitle} />

      <StatTiles tiles={tiles} locale={locale} layout="grid" columns={5} />

      <section className="grid gap-lg tablet:grid-cols-2">
        <Card className="flex flex-col gap-md">
          <SectionTitle>{m.admin.preview.dashboard.usersByStatus}</SectionTitle>
          <DistList locale={locale} entries={userStatusEntries} />
        </Card>
        <Card className="flex flex-col gap-md">
          <SectionTitle>{m.admin.preview.dashboard.orgsByStatus}</SectionTitle>
          <DistList locale={locale} entries={orgStatusEntries} />
        </Card>
      </section>
      <p className="text-label text-fg-muted">{m.admin.preview.dashboard.statusDistributionNote}</p>
    </div>
  );
}
