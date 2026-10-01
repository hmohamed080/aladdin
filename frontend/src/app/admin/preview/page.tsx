import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { adminSummary } from "@/server/queries/admin";
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
  await requireAdminRoute("/admin/preview");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const [s, extras] = await Promise.all([adminSummary(supabase), previewDashboardExtras(supabase)]);

  const totalUsers = Object.values(s.usersByStatus).reduce((a, b) => a + b, 0);
  const verifiedUsers = s.usersByStatus.active ?? 0;
  const pendingUsers = s.usersByStatus.pending_verification ?? 0;
  const suspendedUsers = s.usersByStatus.suspended ?? 0;
  const pendingOrgs = s.orgsByStatus.pending_verification ?? 0;
  const suspendedOrgs = s.orgsByStatus.suspended ?? 0;
  // `orgsTotal` counts every stored organization, archived ones included; the Organizations directory
  // lists non-archived ones only. Say so on the tile instead of leaving the two numbers to disagree.
  const archivedOrgs = s.orgsByStatus.archived ?? 0;

  const cards = m.admin.preview.dashboard.cards;
  const tiles: Tile[] = [
    { label: cards.totalUsers, value: totalUsers, Icon: UsersIcon, href: "/admin/preview/users" },
    {
      label: cards.newRegistrations,
      value: extras.newRegistrationsThisWeek,
      Icon: TrendingUpIcon,
      tone: "info",
      href: "/admin/preview/users",
    },
    {
      label: cards.pendingVerification,
      value: pendingUsers,
      Icon: ClockIcon,
      tone: "warning",
      href: "/admin/preview/users?status=pending",
    },
    {
      label: cards.verifiedApproved,
      value: verifiedUsers,
      Icon: BadgeCheckIcon,
      tone: "success",
      href: "/admin/preview/users?status=verified",
    },
    {
      label: cards.rejected,
      value: extras.rejectedUserVerifications,
      Icon: XIcon,
      tone: "danger",
      href: "/admin/preview/users?status=rejected",
    },
    {
      label: cards.suspendedUsers,
      value: suspendedUsers,
      Icon: AlertIcon,
      tone: "warning",
      href: "/admin/preview/users?status=suspended",
    },
    {
      label: cards.organizations,
      value: s.orgsTotal,
      hint: archivedOrgs > 0 ? t("admin.preview.dashboard.cards.organizationsIncludesArchived", { n: formatCount(archivedOrgs, locale) }) : undefined,
      Icon: BuildingIcon,
      href: "/admin/preview/organizations",
    },
    {
      label: cards.pendingOrgVerification,
      value: pendingOrgs,
      Icon: ClockIcon,
      tone: "warning",
      href: "/admin/preview/organizations?status=pending",
    },
    {
      label: cards.pendingNetworkReferrals,
      value: extras.pendingReferralsTotal,
      Icon: HandshakeIcon,
      tone: "info",
      href: "/admin/preview/review",
    },
    {
      label: cards.suspendedOrgs,
      value: suspendedOrgs,
      Icon: ShieldIcon,
      tone: "warning",
      href: "/admin/preview/organizations?status=suspended",
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
