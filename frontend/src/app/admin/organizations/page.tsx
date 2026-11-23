import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { describeLocation } from "@/lib/location/describe-location";
import { loadOrganizationsDirectory, loadPendingOrganizationVerifications } from "@/server/queries/admin-directory";
import { parseOrgsDirectoryParams, pageWindow } from "@/features/admin-preview/directory-params";
import { localizedName, type AdminDirectoryOrg } from "@/features/admin-preview/directory-mappers";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatNumber } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { StatePanel } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { TabLinks } from "@/components/ui/stat-tiles";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { RowIconLink, RowIconDisabled } from "@/features/admin-preview/row-icon-button";
import { UserVerificationControls } from "@/features/admin/user-verification-controls";
import { AutoFilters, SortableHeader } from "@/features/admin-preview/auto-filters";
import { EyeIcon, SettingsIcon } from "@/components/ui/icons";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { requireAdminRoute } from "@/server/authorization/admin";
import { can } from "@/lib/permissions/admin";
import { SuspensionAction } from "@/features/admin-ops/suspension";

export const dynamic = "force-dynamic";

type Row = AdminDirectoryOrg;

/**
 * Organizations Directory — Admin Core Phase 1B-A. The approved Phase 0D table
 * over REAL data: `admin_organizations_list` (platform `organizations.read`)
 * searches, filters, sorts and pages the full set in the database.
 *
 * Three approved columns have NO authoritative source today and say so
 * instead of showing invented values: Phone / WhatsApp, City and Profile
 * Completion (organizations have no contact or locality column and no
 * completion formula; ADMIN_USERS_ORGS_READ_AUDIT.md §2). The City filter and
 * the Completion sort are therefore not offered, and no flags are shown —
 * the duplicate signal belongs to the Phase 1B-B duplicate workflow. There is
 * no public organization page, so View on Platform stays disabled.
 */
export default async function PreviewOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireAdminRoute("/admin/organizations");
  const canSuspend = can(access, "organizations.suspend");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const params = parseOrgsDirectoryParams(await searchParams);
  const result = await loadOrganizationsDirectory(supabase, params);
  // Verify / Reject are drawn only for a holder of `organizations.verify` (the RPCs re-check it) and act on the
  // organization's OPEN approval request — one bounded read for this page's rows, never one per row.
  const canVerify = can(access, "organizations.verify");
  const pendingByOrg =
    result.ok && canVerify ? await loadPendingOrganizationVerifications(supabase, result.data.rows.map((o) => o.id)) : new Map();

  const d = m.admin.preview.directory;
  const t = m.admin.preview.organizations;
  const userCols = m.admin.preview.users.columns;
  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const approvalLabels = m.admin.orgs.approvalState as Record<string, string>;
  const cols = t.columns;
  const rowActionLabels = t.rowActions;
  const platform = m.admin.preview.platformView;
  const keep = {
    q: params.search ?? undefined,
    type: params.orgType ?? undefined,
    pageSize: params.pageSize === 10 ? undefined : String(params.pageSize),
    sort: params.sort === "registered:desc" ? undefined : params.sort,
  };

  const provenanceLabel = (source: string | null) => {
    if (source === "salesperson_referral") return t.provenanceSales;
    if (source === "installer_referral") return t.provenanceInstaller;
    return t.provenanceSelfCreated;
  };
  const unavailable = (hint: string) => (
    <span className="text-fg-muted" title={hint}>
      {d.unavailable}
    </span>
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: cols.name,
      minWidth: "15rem",
      grow: true,
      cell: (o) => {
        const name = localizedName(o, locale);
        return <RecordCell wrap title={name} href={`/admin/organizations/${o.id}`} avatar={<Monogram name={name} size={28} />} />;
      },
    },
    { key: "type", header: cols.type, minWidth: "10rem", cell: (o) => typeLabels[o.orgType] ?? o.orgType },
    {
      key: "owner",
      header: cols.owner,
      minWidth: "11rem",
      secondary: true,
      cell: (o) =>
        o.owner ? (
          <RecordCell wrap title={o.owner.displayName || m.admin.users.unnamed} href={`/admin/users/${o.owner.userId}`} />
        ) : (
          <span className="text-fg-muted">{t.noOwner}</span>
        ),
    },
    {
      key: "phone",
      header: userCols.phone,
      minWidth: "11rem",
      nowrap: true,
      secondary: true,
      cell: (o) => (o.contactPhone ? <span dir="ltr" className="text-label">{o.contactPhone}</span> : unavailable(d.orgContactUnavailable)),
    },
    {
      key: "city",
      header: userCols.city,
      minWidth: "10rem",
      secondary: true,
      cell: (o) =>
        describeLocation({ governorate: o.governorate ?? null, city: o.city ?? null, cityCustomName: o.cityCustomName ?? null }, locale) ??
        unavailable(d.orgCityUnavailable),
    },
    {
      key: "verification",
      header: cols.verification,
      minWidth: "8rem",
      nowrap: true,
      cell: (o) => <StatusBadge status={o.approvalState} label={approvalLabels[o.approvalState] ?? o.approvalState} />,
    },
    { key: "members", header: cols.members, minWidth: "6rem", numeric: true, secondary: true, cell: (o) => formatNumber(o.memberCount, locale) },
    { key: "branches", header: cols.branches, minWidth: "6rem", numeric: true, secondary: true, cell: (o) => formatNumber(o.branchCount, locale) },
    {
      key: "status",
      header: cols.status,
      minWidth: "7.5rem",
      nowrap: true,
      cell: (o) => <StatusBadge status={o.status} label={statusLabels[o.status] ?? o.status} />,
    },
    {
      key: "created",
      header: <SortableHeader field="registered" label={cols.created} isDefault />,
      minWidth: "8.5rem",
      nowrap: true,
      secondary: true,
      cell: (o) => formatAdminDate(o.createdAt, locale),
    },
    { key: "completeness", header: userCols.completeness, minWidth: "9rem", nowrap: true, secondary: true, cell: () => unavailable(d.orgCompletionUnavailable) },
    { key: "provenance", header: cols.provenance, minWidth: "10rem", secondary: true, cell: (o) => provenanceLabel(o.source) },
    { key: "flags", header: userCols.flags, minWidth: "10rem", secondary: true, cell: () => <span className="text-fg-muted">—</span> },
    {
      key: "actions",
      header: "",
      minWidth: "13rem",
      cell: (o) => {
        const more: RowAction[] = [
          { kind: "link", label: rowActionLabels.viewOwner, href: `/admin/organizations/${o.id}?tab=ownership` },
          { kind: "link", label: rowActionLabels.viewMembers, href: `/admin/organizations/${o.id}?tab=members` },
          { kind: "link", label: rowActionLabels.viewNetwork, href: `/admin/organizations/${o.id}?tab=network` },
          { kind: "link", label: rowActionLabels.addNote, href: `/admin/organizations/${o.id}?tab=notes` },
          { kind: "link", label: rowActionLabels.audit, href: `/admin/organizations/${o.id}?tab=audit` },
        ];

        return (
          <span className="flex items-center justify-end gap-0.5">
            {/* No public organization route exists on Aladdin — a made-up URL would 404. */}
            <RowIconDisabled label={platform.viewOnPlatform} reason={platform.orgNotAvailable} Icon={EyeIcon} />
            <RowIconLink href={`/admin/organizations/${o.id}`} label={platform.manage} Icon={SettingsIcon} />
            {/* Real decisions: the same actions as the Verifications queue (permission, state machine, audit). */}
            {canVerify && (o.status === "pending_verification" || pendingByOrg.has(o.id)) ? (
              <UserVerificationControls subjectId={o.id} pending={pendingByOrg.get(o.id) ?? null} compact subjectType="organization" canInitiate />
            ) : null}
            {canSuspend ? (
              <SuspensionAction m={m} subjectType="organization" subjectId={o.id} suspended={o.status === "suspended"} compact />
            ) : null}
            <RowActionsMenu label={t.title} actions={more} />
          </span>
        );
      },
    },
  ];

  const filters = (
    <AutoFilters
      fields={[
        { kind: "text", name: "q", placeholder: d.orgsSearchPlaceholder },
        {
          kind: "select",
          name: "type",
          anyLabel: m.admin.preview.users.anyType,
          options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
        },
      ]}
    />
  );

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-lg">
        <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} />
        {filters}
        <StatePanel title={d.loadError} />
      </div>
    );
  }

  const { rows, total, page, counts } = result.data;
  const pager = pageWindow(total, page, params.pageSize, rows.length);

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} count={total} />

      <TabLinks
        basePath="/admin/organizations"
        param="status"
        current={params.status ?? ""}
        locale={locale}
        keep={keep}
        label={m.admin.preview.users.statusTabs.all}
        tabs={[
          { value: "", label: m.admin.preview.users.statusTabs.all, count: counts.all },
          { value: "pending", label: m.admin.preview.users.statusTabs.pending, count: counts.pending },
          { value: "verified", label: m.admin.preview.users.statusTabs.verified, count: counts.verified },
          { value: "suspended", label: m.admin.preview.users.statusTabs.suspended, count: counts.suspended },
          { value: "rejected", label: m.admin.preview.users.statusTabs.rejected, count: counts.rejected },
        ]}
      />

      {filters}

      {total === 0 ? (
        <StatePanel title={t.empty} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            caption={t.title}
            minWidth="100rem"
            stackBelow="desktop"
            empty={<StatePanel title={t.empty} />}
          />
          <TablePagination {...pager} pageSize={params.pageSize} />
        </>
      )}
    </div>
  );
}
