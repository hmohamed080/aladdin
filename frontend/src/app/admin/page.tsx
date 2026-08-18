import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { adminSummary } from "@/server/queries/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatCount } from "@/lib/ui/format";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { AdminHeader, StatTile, DistList } from "@/features/admin/parts";
import { AuditFeed } from "@/features/admin/audit-feed";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const s = await adminSummary(supabase);

  const label = (map: Record<string, string>, key: string) => map[key] ?? key;
  const totalUsers = Object.values(s.usersByStatus).reduce((a, b) => a + b, 0);

  // `unknown` is how the tally buckets a null persona: a business-only identity.
  const typeEntries = Object.entries(s.usersByType)
    .map(([k, v]) => ({
      label: k === "unknown" ? m.admin.users.businessOnly : label(m.accountType as Record<string, string>, k),
      value: v,
    }))
    .sort((a, b) => b.value - a.value);
  const statusEntries = Object.entries(s.usersByStatus).map(([k, v]) => ({
    label: label(m.admin.status as Record<string, string>, k),
    value: v,
  }));
  const orgStatusEntries = Object.entries(s.orgsByStatus).map(([k, v]) => ({
    label: label(m.admin.status as Record<string, string>, k),
    value: v,
  }));

  return (
    <div className="flex flex-col gap-xl">
      <AdminHeader locale={locale} title={m.admin.dashboard.title} subtitle={m.admin.dashboard.subtitle} />

      <section className="grid grid-cols-2 gap-md tablet:grid-cols-4">
        <StatTile locale={locale} label={m.admin.dashboard.totalUsers} value={totalUsers} />
        <StatTile
          locale={locale}
          label={m.admin.dashboard.totalOrgs}
          value={s.orgsTotal}
          hint={`${formatCount(s.orgsVerified, locale)} ${m.admin.dashboard.verified}`}
        />
        <Link href="/admin/verifications" className="contents">
          <StatTile locale={locale} label={m.admin.dashboard.pendingReviews} value={s.pendingVerifications} />
        </Link>
        <StatTile locale={locale} label={m.admin.dashboard.activeUsers} value={s.usersByStatus.active ?? 0} />
      </section>

      <section className="grid gap-lg tablet:grid-cols-2">
        <Card className="flex flex-col gap-md">
          <SectionTitle>{m.admin.dashboard.usersByType}</SectionTitle>
          <DistList locale={locale} entries={typeEntries} />
        </Card>
        <div className="flex flex-col gap-lg">
          <Card className="flex flex-col gap-md">
            <SectionTitle>{m.admin.dashboard.usersByStatus}</SectionTitle>
            <DistList locale={locale} entries={statusEntries} />
          </Card>
          <Card className="flex flex-col gap-md">
            <SectionTitle>{m.admin.dashboard.orgsByStatus}</SectionTitle>
            <DistList locale={locale} entries={orgStatusEntries} />
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle action={<Link href="/admin/audit" className="text-label font-medium text-accent hover:underline">{m.admin.dashboard.seeAudit} →</Link>}>
          {m.admin.dashboard.recentActivity}
        </SectionTitle>
        <AuditFeed entries={s.recentAudit} locale={locale} />
      </section>
    </div>
  );
}
