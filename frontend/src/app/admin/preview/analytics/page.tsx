import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { adminSummary } from "@/server/queries/admin";
import {
  previewTrafficForRange,
  PREVIEW_PAGE_HITS,
  PREVIEW_TOP_EVENTS,
  previewVisitorRows,
  type PreviewVisitorRow,
} from "@/features/admin-preview/fixtures";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatAdminDateTime, formatNumber } from "@/lib/ui/format";
import { AdminHeader } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel, Badge } from "@/components/ui/primitives";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { DonutSplit, RankedBars } from "@/components/ui/charts";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { AnalyticsRange, type RangePreset } from "@/features/admin-preview/analytics-range";
import { InteractiveTrendChart } from "@/features/admin-preview/interactive-trend-chart";
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { canonicalRoute } from "@/features/admin-preview/table-state";
import { EyeIcon, LogOutIcon, TrendingUpIcon, UsersIcon, ClockIcon } from "@/components/ui/icons";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type PageRow = { path: string; views: number; clicks: number; avgTimeSeconds: number };

/**
 * Analytics — Phase 0D (revised). Aladdin still has NO product-usage tracking
 * table (grepped every migration for `user_events`/`page_view`/`click_event`/
 * `last_active_at`/`ip_address` — zero matches), so everything except "Total
 * registered" and "Registrations by account type" (both real, from
 * `adminSummary()`) is fixture data behind a permanent banner. This page never
 * starts tracking anything and never collects an IP.
 *
 * What changed in Phase 0D:
 *  - **Range presets** Today / Last 7 days / Last 30 days / Custom (From–To).
 *  - **Landing Page Views** is the primary KPI. Profile Views, Searches, Job
 *    Applications and Clicks cards are gone; Signups, Logins, Page Engagement,
 *    Total Registered and visitor-to-signup conversion stay.
 *  - **Top Pages are grouped by canonical route**: `/profile/1204` and
 *    `/profile/88` are ONE page, `/profile/[id]`.
 *  - **Visitors** use `DD/MM/YYYY HH:mm:ss`.
 *  - **Interactive chart** — legend toggles, hover/keyboard tooltip, range
 *    controls — that never calls itself "Live".
 * Admin Audit (admin/system actions) and Analytics (product usage) are never mixed.
 */
export default async function PreviewAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; event?: string; persona?: string }>;
}) {
  await requireAdminRoute("/admin/preview/analytics");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { range: rangeParam, from: fromParam, to: toParam, event: eventFilter, persona: personaFilter } = await searchParams;
  const s = await adminSummary(supabase);
  const totalUsers = Object.values(s.usersByStatus).reduce((a, b) => a + b, 0);
  const t = m.admin.preview.analytics;
  const typeLabels = m.accountType as Record<string, string>;

  // Resolve the range. An unknown preset or a malformed / inverted custom pair
  // falls back to Last 7 days — never silently to some other window.
  const now = new Date();
  const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  let preset: RangePreset = rangeParam === "today" || rangeParam === "30" || rangeParam === "custom" ? rangeParam : "7";
  let fromIso = new Date(Date.parse(todayIso) - 6 * DAY).toISOString().slice(0, 10);
  let toIso = todayIso;
  if (preset === "today") fromIso = todayIso;
  else if (preset === "30") fromIso = new Date(Date.parse(todayIso) - 29 * DAY).toISOString().slice(0, 10);
  else if (preset === "custom") {
    if (fromParam && toParam && ISO_DAY.test(fromParam) && ISO_DAY.test(toParam) && fromParam <= toParam && toParam <= todayIso) {
      fromIso = fromParam;
      toIso = toParam;
    } else {
      preset = "7";
    }
  }

  const buckets = previewTrafficForRange(new Date(fromIso), new Date(toIso));
  const hourly = buckets.length === 24 && fromIso === toIso;
  const bucketLabel = (iso: string) =>
    hourly
      ? `${formatNumber(new Date(iso).getUTCHours(), locale, { minimumIntegerDigits: 2, useGrouping: false })}:00`
      : formatAdminDate(iso, locale).slice(0, 5);

  const landingPageViews = buckets.reduce((sum, b) => sum + b.landingPageViews, 0);
  const signups = buckets.reduce((sum, b) => sum + b.signups, 0);
  const logins = buckets.reduce((sum, b) => sum + b.logins, 0);
  const engagement = Math.round(buckets.reduce((sum, b) => sum + b.engagementSeconds, 0) / Math.max(1, buckets.length));
  const conversion = landingPageViews > 0 ? Math.round((signups / landingPageViews) * 1000) / 10 : 0;

  const tiles: Tile[] = [
    { label: t.kpi.signups, value: signups, Icon: TrendingUpIcon, tone: "success" },
    { label: t.kpi.logins, value: logins, Icon: LogOutIcon, tone: "neutral" },
    { label: t.pageEngagement, value: t.engagementValue.replace("{seconds}", formatNumber(engagement, locale)), Icon: ClockIcon, tone: "info" },
    { label: t.kpi.totalRegistered, value: totalUsers, Icon: UsersIcon, tone: "success", href: "/admin/preview/users" },
    { label: t.kpi.conversionRate, value: `${formatNumber(conversion, locale)}%`, Icon: TrendingUpIcon, tone: "info" },
  ];

  // Top pages: group concrete URLs by canonical route, summing views/clicks and
  // weighting the average time by views.
  const grouped = new Map<string, { views: number; clicks: number; timeWeighted: number }>();
  for (const hit of PREVIEW_PAGE_HITS) {
    const route = canonicalRoute(hit.path);
    const g = grouped.get(route) ?? { views: 0, clicks: 0, timeWeighted: 0 };
    g.views += hit.views;
    g.clicks += hit.clicks;
    g.timeWeighted += hit.avgTimeSeconds * hit.views;
    grouped.set(route, g);
  }
  const topPages: PageRow[] = [...grouped.entries()]
    .map(([path, g]) => ({ path, views: g.views, clicks: g.clicks, avgTimeSeconds: Math.round(g.timeWeighted / g.views) }))
    .sort((a, b) => b.views - a.views);

  const topEvents = eventFilter ? PREVIEW_TOP_EVENTS.filter((e) => e.event === eventFilter) : PREVIEW_TOP_EVENTS;
  const visitors = previewVisitorRows().filter((v) => !personaFilter || v.personaType === personaFilter);
  const registrationsSlices = Object.entries(s.usersByType).map(([k, v]) => ({
    label: k === "unknown" ? m.admin.users.businessOnly : (typeLabels[k] ?? k),
    value: v,
  }));

  const topPagesColumns: Column<PageRow>[] = [
    { key: "path", header: t.topPagesColumns.page, minWidth: "14rem", grow: true, cell: (p) => <code dir="ltr" className="text-label">{p.path}</code> },
    { key: "views", header: t.topPagesColumns.views, minWidth: "6rem", numeric: true, cell: (p) => formatNumber(p.views, locale) },
    { key: "clicks", header: t.topPagesColumns.clicks, minWidth: "6rem", numeric: true, secondary: true, cell: (p) => formatNumber(p.clicks, locale) },
    { key: "avgTime", header: t.topPagesColumns.avgTime, minWidth: "7rem", numeric: true, secondary: true, cell: (p) => `${formatNumber(p.avgTimeSeconds, locale)}s` },
  ];

  const visitorColumns: Column<PreviewVisitorRow>[] = [
    {
      key: "userOrGuest",
      header: t.visitorColumns.userOrGuest,
      minWidth: "9rem",
      nowrap: true,
      cell: (v) => (v.personaType ? <Badge tone="success">{t.registered}</Badge> : <Badge tone="neutral">{t.guest}</Badge>),
    },
    {
      key: "identity",
      header: t.visitorColumns.identity,
      minWidth: "14rem",
      grow: true,
      cell: (v) =>
        v.personaType ? (
          <RecordCell wrap title={v.label} meta={typeLabels[v.personaType] ?? v.personaType} avatar={<Monogram name={v.label} size={28} />} />
        ) : (
          <span className="text-fg-muted">{t.unresolvedIdentity}</span>
        ),
    },
    { key: "ip", header: `${t.ipAddress}${PREVIEW_MARK}`, minWidth: "9rem", nowrap: true, secondary: true, cell: () => <span className="text-fg-muted">{t.ipNotTracked}</span> },
    { key: "firstSeen", header: t.visitorColumns.firstSeen, minWidth: "11.5rem", nowrap: true, cell: (v) => formatAdminDateTime(v.firstSeen, locale) },
    { key: "lastActivity", header: t.visitorColumns.lastActivity, minWidth: "11.5rem", nowrap: true, cell: (v) => formatAdminDateTime(v.lastActive, locale) },
    { key: "events", header: t.visitorColumns.events, minWidth: "6rem", numeric: true, cell: (v) => formatNumber(v.totalEvents, locale) },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} />

      <p role="note" className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">
        {t.fixtureBanner}
      </p>

      <AnalyticsRange current={preset} from={fromIso} to={toIso} max={todayIso} />

      <section className="grid gap-md desktop:grid-cols-[minmax(0,20rem)_1fr]">
        {/* The primary KPI: how many people reached the landing page. */}
        <Card className="flex flex-col justify-center gap-1">
          <p className="flex items-center gap-1.5 text-label font-medium text-fg-secondary">
            <EyeIcon size={16} />
            {t.landingPageViews}
          </p>
          <p className="text-display tabular-nums text-fg">{formatNumber(landingPageViews, locale)}</p>
        </Card>
        <StatTiles tiles={tiles} locale={locale} layout="grid" columns={3} />
      </section>
      <PreviewLegend>{t.kpiFixtureNote}</PreviewLegend>

      <Card className="flex flex-col gap-md">
        <SectionTitle>{t.trafficOverTime}</SectionTitle>
        <InteractiveTrendChart
          rangeControls={!hourly}
          ariaLabel={t.trafficOverTime}
          series={[
            { key: "landing", label: t.landingPageViews, points: buckets.map((b) => ({ label: bucketLabel(b.at), value: b.landingPageViews })) },
            { key: "signups", label: t.kpi.signups, points: buckets.map((b) => ({ label: bucketLabel(b.at), value: b.signups })) },
            { key: "logins", label: t.kpi.logins, points: buckets.map((b) => ({ label: bucketLabel(b.at), value: b.logins })) },
          ]}
        />
      </Card>

      <AutoFilters
        fields={[
          { kind: "select", name: "event", anyLabel: t.anyEvent, options: PREVIEW_TOP_EVENTS.map((e) => ({ value: e.event, label: e.event })) },
          { kind: "select", name: "persona", anyLabel: t.personaFilter, options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })) },
        ]}
      />

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
          <RankedBars items={topEvents.map((e) => ({ label: e.event, value: e.count }))} locale={locale} emptyLabel={m.admin.preview.duplicates.none} bar="iris" rank />
        </Card>
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{t.topPages}</SectionTitle>
        <p className="text-label text-fg-muted">{t.canonicalNote}</p>
        <DataTable columns={topPagesColumns} rows={topPages} rowKey={(p) => p.path} caption={t.topPages} minWidth="34rem" empty={<StatePanel title={m.admin.preview.duplicates.none} />} />
      </section>

      <section className="flex flex-col gap-md">
        <SectionTitle>{t.visitorTable}</SectionTitle>
        {visitors.length === 0 ? (
          <StatePanel title={m.admin.preview.duplicates.none} />
        ) : (
          <DataTable columns={visitorColumns} rows={visitors} rowKey={(v) => v.id} caption={t.visitorTable} minWidth="62rem" stackBelow="desktop" empty={<StatePanel title={m.admin.preview.duplicates.none} />} />
        )}
        <PreviewLegend>{t.ipPrivacyNote}</PreviewLegend>
      </section>
    </div>
  );
}
