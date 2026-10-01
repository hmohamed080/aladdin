import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadUsersDirectory } from "@/server/queries/admin-directory";
import { parseUsersDirectoryParams, pageWindow } from "@/features/admin-preview/directory-params";
import { localizedName, type AdminDirectoryUser } from "@/features/admin-preview/directory-mappers";
import { GOVERNORATES } from "@/lib/onboarding/persona-fields";
import { whatsappShareUrl } from "@/lib/contact/whatsapp";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatCount, formatNumber } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { StatePanel, Badge, Card } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { TabLinks } from "@/components/ui/stat-tiles";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { RowIconLink, RowIconDisabled } from "@/features/admin-preview/row-icon-button";
import { RowIconAction } from "@/features/admin-preview/row-icon-action";
import { AutoFilters, SortableHeader } from "@/features/admin-preview/auto-filters";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { EyeIcon, SettingsIcon, WhatsAppIcon, CheckIcon, XIcon } from "@/components/ui/icons";
import { requireAdminRoute } from "@/server/authorization/admin";
import { loadStaffRanks } from "@/server/queries/admin-rbac";
import { canSuspendUser, staffRankOf } from "@/features/admin-rbac/eligibility";
import { SuspensionAction } from "@/features/admin-ops/suspension";

export const dynamic = "force-dynamic";

type Row = AdminDirectoryUser;

function filterHref(keep: Record<string, string | undefined>, overrides: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...keep, ...overrides })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "?";
}

/**
 * Users Directory — Admin Core Phase 1B-A. The approved Phase 0D table (twelve
 * columns, shared `DataTable` + pagination footer) over REAL data only.
 *
 * Every row, total and tab count comes from `admin_users_list` (platform
 * `users.read`): search, filters, sort and pagination run in the database over
 * the full dataset — nothing is fetched and then filtered or paged here. The
 * URL is parsed by `parseUsersDirectoryParams`, which turns any invalid value
 * into a safe default. Field sources: docs/admin/ADMIN_USERS_ORGS_READ_AUDIT.md.
 *
 * Last Active has no authoritative source (product activity is not tracked),
 * so it says so rather than showing a sign-in time under that label. Row
 * actions are still Preview dialogs (mutations are Phase 1B-B); the shell's
 * banner says so. The eye opens `/p/[profileId]` — the PROFILE id — only when
 * `profile_public_directory` will actually render it.
 */
export default async function PreviewUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireAdminRoute("/admin/preview/users");
  const supabase = await getServerSupabase();
  // Row-level Suspend / Restore follows the server rule (see `canSuspendUser`): never your own row, never Admin
  // Staff at or above your rank. The RPC remains the judge; this only avoids drawing an action that can never work.
  const {
    data: { user: caller },
  } = await supabase.auth.getUser();
  const staffRanks = await loadStaffRanks(supabase, access);
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const params = parseUsersDirectoryParams(await searchParams);
  const result = await loadUsersDirectory(supabase, params);

  const d = m.admin.preview.directory;
  const t = m.admin.preview.users;
  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const governorateLabels = m.onboarding.consumer.governorates as Record<string, string>;
  const cityLabels = m.onboarding.consumer.cities as Record<string, string>;
  const verificationStateLabels = t.verificationState;
  const flagLabels = t.flagLabels;
  const cols = t.columns;
  const rowActionLabels = t.rowActions;
  const platform = m.admin.preview.platformView;
  // Everything but `page` survives a tab switch (a new tab starts on page 1).
  const keep = {
    q: params.search ?? undefined,
    type: params.accountType ?? undefined,
    verification: params.verification ?? undefined,
    governorate: params.governorate ?? undefined,
    pageSize: params.pageSize === 10 ? undefined : String(params.pageSize),
    sort: params.sort === "registered:desc" ? undefined : params.sort,
  };

  const location = (u: Row) => {
    if (!u.governorate) return null;
    const gov = governorateLabels[u.governorate] ?? u.governorate;
    return u.city ? `${gov} · ${cityLabels[u.city] ?? u.city}` : gov;
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: cols.name,
      minWidth: "15rem",
      grow: true,
      cell: (u) => {
        const name = localizedName(u.displayName, locale) || m.admin.users.unnamed;
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <RecordCell wrap title={name} href={`/admin/preview/users/${u.id}`} avatar={<Monogram name={name} size={28} />} />
            {u.flags.length > 0 ? (
              <span title={u.flags.map((f) => flagLabels[f]).join(", ")} aria-hidden="true" className="shrink-0 text-warning">
                ●
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "email",
      header: cols.email,
      minWidth: "16rem",
      nowrap: true,
      secondary: true,
      cell: (u) => (u.email ? <span dir="ltr" className="text-label">{u.email}</span> : <span className="text-fg-muted">—</span>),
    },
    {
      key: "phone",
      header: cols.phone,
      minWidth: "11rem",
      nowrap: true,
      cell: (u) =>
        u.phone ? (
          <span className="flex items-center gap-1.5">
            <span dir="ltr" className="text-label">{u.phone}</span>
            <RowIconLink
              href={whatsappShareUrl({ phone: u.phone, message: `Hi ${localizedName(u.displayName, locale)}` })}
              label={rowActionLabels.whatsapp}
              Icon={WhatsAppIcon}
              tone="success"
              external
            />
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: "organization",
      header: cols.organization,
      minWidth: "12rem",
      secondary: true,
      cell: (u) =>
        u.organization ? (
          <RecordCell
            wrap
            title={localizedName(u.organization, locale)}
            href={`/admin/preview/organizations/${u.organization.id}`}
            meta={u.organizationCount > 1 ? `+${formatCount(u.organizationCount - 1, locale)}` : undefined}
          />
        ) : (
          <span className="text-fg-muted">{t.noOrganization}</span>
        ),
    },
    {
      key: "city",
      header: cols.city,
      minWidth: "10rem",
      secondary: true,
      cell: (u) => location(u) ?? <span className="text-fg-muted">—</span>,
    },
    {
      key: "verification",
      header: cols.verification,
      minWidth: "8rem",
      nowrap: true,
      cell: (u) => <StatusBadge status={u.verificationState} label={verificationStateLabels[u.verificationState]} />,
    },
    {
      key: "registered",
      header: <SortableHeader field="registered" label={cols.registered} isDefault />,
      minWidth: "8.5rem",
      nowrap: true,
      secondary: true,
      cell: (u) => formatAdminDate(u.createdAt, locale),
    },
    {
      key: "status",
      header: cols.status,
      minWidth: "7.5rem",
      nowrap: true,
      cell: (u) => <StatusBadge status={u.status} label={statusLabels[u.status] ?? u.status} />,
    },
    {
      key: "lastActive",
      header: cols.lastActive,
      minWidth: "8.5rem",
      nowrap: true,
      secondary: true,
      cell: () => (
        <span className="text-fg-muted" title={d.lastActiveHint}>
          {t.lastActiveUnavailable}
        </span>
      ),
    },
    {
      key: "completeness",
      header: <SortableHeader field="completeness" label={cols.completeness} />,
      minWidth: "9rem",
      nowrap: true,
      secondary: true,
      cell: (u) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-12 overflow-hidden rounded-pill bg-surface-2">
            <span className="block h-full rounded-pill bg-accent-solid" style={{ width: `${u.completion}%` }} />
          </span>
          <span className="tabular-nums">{formatNumber(u.completion, locale)}%</span>
        </span>
      ),
    },
    {
      key: "flags",
      header: cols.flags,
      minWidth: "10rem",
      secondary: true,
      cell: (u) =>
        u.flags.length === 0 ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {u.flags.map((f) => (
              <Badge key={f} tone="warning">
                {flagLabels[f]}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      minWidth: "13rem",
      cell: (u) => {
        const more: RowAction[] = [
          { kind: "link", label: rowActionLabels.activity, href: `/admin/preview/users/${u.id}?tab=activity` },
          { kind: "link", label: rowActionLabels.points, href: `/admin/preview/users/${u.id}?tab=points` },
        ];
        if (u.organization) more.push({ kind: "link", label: rowActionLabels.viewOrg, href: `/admin/preview/organizations/${u.organization.id}` });
        more.push({ kind: "link", label: rowActionLabels.addNote, href: `/admin/preview/users/${u.id}?tab=notes` });
        more.push({ kind: "link", label: rowActionLabels.followUp, href: `/admin/preview/users/${u.id}?tab=followup` });
        more.push({ kind: "link", label: rowActionLabels.report, href: `/admin/preview/users/${u.id}?tab=report` });
        more.push({ kind: "link", label: rowActionLabels.audit, href: `/admin/preview/users/${u.id}?tab=audit` });

        return (
          <span className="flex items-center justify-end gap-0.5">
            {u.profileId && u.publicProfileAvailable ? (
              <RowIconLink href={`/p/${u.profileId}`} label={platform.viewOnPlatform} Icon={EyeIcon} external />
            ) : (
              <RowIconDisabled label={platform.viewOnPlatform} reason={platform.notListed} Icon={EyeIcon} />
            )}
            <RowIconLink href={`/admin/preview/users/${u.id}`} label={platform.manage} Icon={SettingsIcon} />
            {u.status === "pending_verification" ? (
              <>
                <RowIconAction
                  label={rowActionLabels.verify}
                  icon={<CheckIcon size={16} />}
                  tone="success"
                  title={m.admin.preview.userOverview.verify}
                  confirmLabel={m.admin.preview.userOverview.verify}
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
            ) : null}
            {canSuspendUser(access, caller?.id ?? "", { userId: u.id, staffRank: staffRankOf(staffRanks, u.id) }) ? (
              <SuspensionAction m={m} subjectType="user" subjectId={u.id} suspended={u.status === "suspended"} compact />
            ) : null}
            <RowActionsMenu label={t.moreActions} actions={more} />
          </span>
        );
      },
    },
  ];

  const filters = (
    <AutoFilters
      fields={[
        { kind: "text", name: "q", placeholder: d.usersSearchPlaceholder },
        {
          kind: "select",
          name: "type",
          anyLabel: t.anyType,
          options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
        },
        {
          kind: "select",
          name: "verification",
          anyLabel: t.anyVerification,
          options: (["unverified", "pending", "verified", "rejected"] as const).map((v) => ({ value: v, label: verificationStateLabels[v] })),
        },
        {
          kind: "select",
          name: "governorate",
          anyLabel: d.anyGovernorate,
          options: GOVERNORATES.map((g) => ({ value: g, label: governorateLabels[g] ?? g })),
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

      {counts.pending > 0 ? (
        <Card pad="sm" className="flex flex-col gap-1.5">
          <p className="text-label font-medium text-fg-secondary">{t.warnings.title}</p>
          <div className="flex flex-wrap gap-sm">
            <a
              href={filterHref(keep, { status: "pending" })}
              className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20"
            >
              {t.warnings.verificationReview.replace("{count}", formatCount(counts.pending, locale))}
            </a>
          </div>
        </Card>
      ) : null}

      <TabLinks
        basePath="/admin/preview/users"
        param="status"
        current={params.status ?? ""}
        locale={locale}
        keep={keep}
        label={t.statusTabs.all}
        tabs={[
          { value: "", label: t.statusTabs.all, count: counts.all },
          { value: "pending", label: t.statusTabs.pending, count: counts.pending },
          { value: "verified", label: t.statusTabs.verified, count: counts.verified },
          { value: "suspended", label: t.statusTabs.suspended, count: counts.suspended },
          { value: "rejected", label: t.statusTabs.rejected, count: counts.rejected },
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
            rowKey={(u) => u.id}
            caption={t.title}
            minWidth="90rem"
            stackBelow="desktop"
            empty={<StatePanel title={t.empty} />}
          />
          <TablePagination {...pager} pageSize={params.pageSize} />
        </>
      )}
    </div>
  );
}
