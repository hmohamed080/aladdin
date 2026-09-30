import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadOrganizationsDirectory } from "@/server/queries/admin-directory";
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
import { RowIconAction } from "@/features/admin-preview/row-icon-action";
import { AutoFilters, SortableHeader } from "@/features/admin-preview/auto-filters";
import { EyeIcon, SettingsIcon, CheckIcon, XIcon, AlertIcon } from "@/components/ui/icons";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { requireAdminRoute } from "@/server/authorization/admin";

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
  await requireAdminRoute("/admin/preview/organizations");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const params = parseOrgsDirectoryParams(await searchParams);
  const result = await loadOrganizationsDirectory(supabase, params);

  const d = m.admin.preview.directory;
  const t = m.admin.preview.organizations;
  const userCols = m.admin.preview.users.columns;
  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const verificationStateLabels = m.admin.preview.users.verificationState;
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
        return <RecordCell wrap title={name} href={`/admin/preview/organizations/${o.id}`} avatar={<Monogram name={name} size={28} />} />;
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
          <RecordCell wrap title={o.owner.displayName || m.admin.users.unnamed} href={`/admin/preview/users/${o.owner.userId}`} />
        ) : (
          <span className="text-fg-muted">{t.noOwner}</span>
        ),
    },
    { key: "phone", header: userCols.phone, minWidth: "11rem", nowrap: true, secondary: true, cell: () => unavailable(d.orgContactUnavailable) },
    { key: "city", header: userCols.city, minWidth: "10rem", secondary: true, cell: () => unavailable(d.orgCityUnavailable) },
    {
      key: "verification",
      header: cols.verification ?? m.admin.orgs.verification,
      minWidth: "8rem",
      nowrap: true,
      cell: (o) => <StatusBadge status={o.verificationState} label={verificationStateLabels[o.verificationState]} />,
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
          { kind: "link", label: rowActionLabels.viewOwner, href: `/admin/preview/organizations/${o.id}?tab=ownership` },
          { kind: "link", label: rowActionLabels.viewMembers, href: `/admin/preview/organizations/${o.id}?tab=members` },
          { kind: "link", label: rowActionLabels.viewNetwork, href: `/admin/preview/organizations/${o.id}?tab=network` },
          { kind: "link", label: rowActionLabels.addNote, href: `/admin/preview/organizations/${o.id}?tab=notes` },
          { kind: "link", label: rowActionLabels.audit, href: `/admin/preview/organizations/${o.id}?tab=audit` },
        ];

        return (
          <span className="flex items-center justify-end gap-0.5">
            {/* No public organization route exists on Aladdin — a made-up URL would 404. */}
            <RowIconDisabled label={platform.viewOnPlatform} reason={platform.orgNotAvailable} Icon={EyeIcon} />
            <RowIconLink href={`/admin/preview/organizations/${o.id}`} label={platform.manage} Icon={SettingsIcon} />
            {o.status === "pending_verification" ? (
              <>
                <RowIconAction
                  label={rowActionLabels.verify}
                  icon={<CheckIcon size={16} />}
                  tone="success"
                  title={m.admin.preview.orgOverview.availableActions}
                  confirmLabel={rowActionLabels.verify}
                  confirmVariant="primary"
                />
                <RowIconAction
                  label={rowActionLabels.reject}
                  icon={<XIcon size={16} />}
                  tone="danger"
                  title={m.admin.preview.review.rejectTitle}
                  body={m.admin.preview.review.rejectBody}
                  confirmLabel={rowActionLabels.reject}
                  confirmVariant="danger"
                />
              </>
            ) : o.status === "suspended" ? (
              <RowIconAction
                label={rowActionLabels.restore}
                icon={<CheckIcon size={16} />}
                tone="success"
                title={t.restoreTitle}
                body={t.restoreBody}
                confirmLabel={rowActionLabels.restore}
                confirmVariant="primary"
              />
            ) : (
              <RowIconAction
                label={rowActionLabels.suspend}
                icon={<AlertIcon size={16} />}
                tone="danger"
                title={t.suspendTitle}
                body={t.suspendBody}
                confirmLabel={rowActionLabels.suspend}
                confirmVariant="danger"
              />
            )}
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
        <AdminHeader locale={locale} title={t.title} subtitle={t.detailSubtitle} />
        {filters}
        <StatePanel title={d.loadError} />
      </div>
    );
  }

  const { rows, total, page, counts } = result.data;
  const pager = pageWindow(total, page, params.pageSize, rows.length);

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={t.title} subtitle={t.detailSubtitle} count={total} />

      <TabLinks
        basePath="/admin/preview/organizations"
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
