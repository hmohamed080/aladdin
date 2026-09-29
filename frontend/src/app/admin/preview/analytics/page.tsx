import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { adminSummary } from "@/server/queries/admin";
import {
  previewTrafficSeriesMulti,
  PREVIEW_TOP_PAGES_DETAILED,
  PREVIEW_TOP_EVENTS,
  previewVisitorRows,
} from "@/features/admin-preview/fixtures";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatNumber } from "@/lib/ui/format";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel, Badge } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { MultiTrendLine, DonutSplit, RankedBars } from "@/components/ui/charts";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { EyeIcon, SearchIcon, BriefcaseIcon, UserIcon, LogOutIcon, TrendingUpIcon, UsersIcon } from "@/components/ui/icons";
import type { PreviewVisitorRow, PreviewTopPageDetailed } from "@/features/admin-preview/fixtures";

export const dynamic = "force-dynamic";

const RANGE_DAYS = [7, 14, 30] as const;

/**
 * Phase 0C — Analytics enrichment. Confirmed (again) before touching this
 * page: no product-usage tracking table exists anywhere in the schema
 * (grepped every migration for `user_events`/`page_view`/`click_event`/
 * `last_active_at`/`ip_address` — zero matches), so every KPI card, the
 * chart, Top Pages and Visitors remain entirely fixture data behind the
 * permanent banner — enriching the PRESENTATION does not manufacture real
 * numbers. "Registrations by account type" and "Total registered" are the
 * two real figures (both reuse `adminSummary()`, already read by the
 * Dashboard). IP address: Aladdin does not capture it anywhere today either
 * — the Visitors column exists to show the INTENDED shape but every cell
 * reads "not tracked" rather than a fabricated address, and this page never
 * starts collecting it (see `PreviewLegend` note below the Visitors table
 * for the retention/authorization considerations a real implementation
 * would need).
 */
export default async function PreviewAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; event?: string; persona?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { range: rangeParam, event: eventFilter, persona: personaFilter } = await searchParams;
  const s = await adminSummary(supabase);
  const totalUsers = Object.values(s.usersByStatus).reduce((a, b) => a + b, 0);

  const days = RANGE_DAYS.includes(Number(rangeParam) as (typeof RANGE_DAYS)[number]) ? Number(rangeParam) : 14;
  const series = previewTrafficSeriesMulti(days);
  const topEvents = eventFilter ? PREVIEW_TOP_EVENTS.filter((e) => e.event === eventFilter) : PREVIEW_TOP_EVENTS;
  const visitors: PreviewVisitorRow[] = previewVisitorRows().filter((v) => !personaFilter || v.personaType === personaFilter);

  const t = m.admin.preview.analytics;
  const typeLabels = m.accountType as Record<string, string>;

  const registrationsSlices = Object.entries(s.usersByType).map(([k, v]) => ({
    label: k === "unknown" ? m.admin.users.businessOnly : (typeLabels[k] ?? k),
    value: v,
  }));

  const totalPageViews = series.reduce((sum, p) => sum + p.pageViews, 0);
  const totalSignups = series.reduce((sum, p) => sum + p.signups, 0);
  const totalClicks = series.reduce((sum, p) => sum + p.clicks, 0);
  const totalProfileViews = series.reduce((sum, p) => sum + p.profileViews, 0);
  const searchCount = PREVIEW_TOP_EVENTS.find((e) => e.event === "search")?.count ?? 0;
  const jobApplicationCount = PREVIEW_TOP_EVENTS.find((e) => e.event === "job_application")?.count ?? 0;
  const loginCount = Math.round(totalPageViews * 0.35);
  const totalVisitors = 480; // deterministic fixture magnitude behind the KPI card, same order as previewVisitorRows()
  const conversionRate = totalVisitors > 0 ? Math.round((totalSignups / totalVisitors) * 100) : 0;

  const kpiTiles: Tile[] = [
    { label: t.kpi.pageViews, value: totalPageViews, Icon: EyeIcon, tone: "info" },
    { label: t.kpi.profileViews, value: totalProfileViews, Icon: UserIcon, tone: "info" },
    { label: t.kpi.search, value: searchCount, Icon: SearchIcon, tone: "neutral" },
    { label: t.kpi.jobApplications, value: jobApplicationCount, Icon: BriefcaseIcon, tone: "accent" },
    { label: t.kpi.signups, value: totalSignups, Icon: TrendingUpIcon, tone: "success" },
    { label: t.kpi.logins, value: loginCount, Icon: LogOutIcon, tone: "neutral" },
    { label: t.kpi.clicks, value: totalClicks, Icon: TrendingUpIcon, tone: "neutral" },
    { label: t.kpi.totalRegistered, value: totalUsers, Icon: UsersIcon, tone: "success", href: "/admin/preview/users" },
    { label: t.kpi.conversionRate, value: `${formatNumber(conversionRate, locale)}%`, Icon: TrendingUpIcon, tone: "info" },
  ];

  const topPagesColumns: Column<PreviewTopPageDetailed>[] = [
    { key: "path", header: t.topPagesColumns.page, grow: true, cell: (p) => <span dir="ltr">{p.path}</span> },
    { key: "views", header: t.topPagesColumns.views, numeric: true, cell: (p) => formatNumber(p.views, locale) },
    { key: "clicks", header: t.topPagesColumns.clicks, numeric: true, secondary: true, cell: (p) => formatNumber(p.clicks, locale) },
    { key: "avgTime", header: t.topPagesColumns.avgTime, numeric: true, secondary: true, cell: (p) => `${formatNumber(p.avgTimeSeconds, locale)}s` },
  ];

  const visitorColumns: Column<PreviewVisitorRow>[] = [
    {
      key: "visitor",
      header: t.columns.visitor,
      grow: true,
      cell: (v) => <RecordCell title={v.label} avatar={<Monogram name={v.label} size={28} />} />,
    },
    {
      key: "registered",
      header: t.registeredOrGuest,
      cell: (v) => (v.personaType ? <Badge tone="success">{t.registered}</Badge> : <Badge tone="neutral">{t.guest}</Badge>),
    },
    { key: "persona", header: t.columns.persona, secondary: true, cell: (v) => (v.personaType ? (typeLabels[v.personaType] ?? v.personaType) : "—") },
    { key: "ip", header: `${t.ipAddress}${PREVIEW_MARK}`, secondary: true, cell: () => <span className="text-fg-muted">{t.ipNotTracked}</span> },
    { key: "firstSeen", header: t.columns.firstSeen, secondary: true, cell: (v) => formatAdminDate(v.firstSeen, locale) },
    { key: "lastActive", header: t.columns.lastActive, cell: (v) => formatAdminDate(v.lastActive, locale) },
    { key: "totalEvents", header: t.columns.totalEvents, numeric: true, cell: (v) => formatNumber(v.totalEvents, locale) },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} />

      <p role="note" className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">
        {t.fixtureBanner}
      </p>

      <AutoFilters
        fields={[
          { kind: "select", name: "range", anyLabel: `${t.dateRange}: 14`, options: RANGE_DAYS.filter((d) => d !== 14).map((d) => ({ value: String(d), label: String(d) })) },
          { kind: "select", name: "event", anyLabel: t.anyEvent, options: PREVIEW_TOP_EVENTS.map((e) => ({ value: e.event, label: e.event })) },
          { kind: "select", name: "persona", anyLabel: t.personaFilter, options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })) },
        ]}
      />

      <StatTiles tiles={kpiTiles} locale={locale} layout="grid" columns={5} />
      <PreviewLegend>{t.kpiFixtureNote}</PreviewLegend>

      <Card className="flex flex-col gap-md">
        <SectionTitle>{t.trafficOverTime}</SectionTitle>
        <MultiTrendLine
          series={[
            { label: t.pageViews, points: series.map((p) => ({ label: p.date.slice(5), value: p.pageViews })) },
            { label: t.signups, points: series.map((p) => ({ label: p.date.slice(5), value: p.signups })) },
            { label: t.kpi.clicks, points: series.map((p) => ({ label: p.date.slice(5), value: p.clicks })) },
            { label: t.profileViews, points: series.map((p) => ({ label: p.date.slice(5), value: p.profileViews })) },
          ]}
          emptyLabel={m.admin.preview.duplicates.none}
          ariaLabel={t.trafficOverTime}
          formatValue={(v) => formatNumber(v, locale)}
        />
      </Card>

      <section className="grid gap-lg tablet:grid-cols-2">
        <Card className="flex flex-col gap-md">
          <SectionTitle>{t.registrationsByPersona}</SectionTitle>
          <DonutSplit
            slices={registrationsSlices}
            emptyLabel={m.admin.preview.duplicates.none}
            ariaLabel={t.registrationsByPersona}
            centerLabel={m.admin.dashboard.totalUsers}
            formatValue={(v) => formatNumber(v, locale)}
            formatShare={(pct) => `${formatNumber(pct, locale)}%`}
          />
        </Card>

        <Card className="flex flex-col gap-md">
          <SectionTitle>{t.topEvents}</SectionTitle>
          <RankedBars
            items={topEvents.map((e) => ({ label: e.event, value: e.count }))}
            locale={locale}
            emptyLabel={m.admin.preview.duplicates.none}
            bar="iris"
            rank
          />
        </Card>
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{t.topPages}</SectionTitle>
        <DataTable columns={topPagesColumns} rows={PREVIEW_TOP_PAGES_DETAILED} rowKey={(p) => p.path} caption={t.topPages} empty={<StatePanel title={m.admin.preview.duplicates.none} />} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{t.visitorTable}</SectionTitle>
        {visitors.length === 0 ? (
          <StatePanel title={m.admin.preview.duplicates.none} />
        ) : (
          <DataTable columns={visitorColumns} rows={visitors} rowKey={(v) => v.id} caption={t.visitorTable} empty={<StatePanel title={m.admin.preview.duplicates.none} />} />
        )}
        <PreviewLegend>{t.ipPrivacyNote}</PreviewLegend>
      </section>
    </div>
  );
}
