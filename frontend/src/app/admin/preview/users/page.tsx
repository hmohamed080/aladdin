import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers } from "@/server/queries/admin";
import { previewUsersDirectoryContext } from "@/server/queries/admin-preview";
import { previewContactFor, previewCityFor, previewCompletenessFor, previewUserDuplicateFlag, PREVIEW_CITIES } from "@/features/admin-preview/fixtures";
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
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { clampPageSize, paginate, parseSort, previewRegisteredAt, sortRows } from "@/features/admin-preview/table-state";
import { EyeIcon, SettingsIcon, WhatsAppIcon, CheckIcon, XIcon, AlertIcon } from "@/components/ui/icons";
import type { AdminUserRow } from "@/server/queries/admin";

export const dynamic = "force-dynamic";

type FlagCode = "possible_duplicate" | "incomplete_critical_profile" | "verification_issue";

type Row = AdminUserRow & {
  email: string;
  phone: string;
  city: string;
  completeness: number;
  duplicate: boolean;
  orgId: string | null;
  orgName: string | null;
  orgCount: number;
  verificationStatus: string | null;
  verificationState: "verified" | "pending" | "unverified" | "rejected";
  flags: FlagCode[];
  /** Preview-only displayed registration date; the real `createdAt` is untouched. */
  registeredAt: string;
  profileId: string | null;
  publicProfileAvailable: boolean;
};

function filterHref(keep: Record<string, string | undefined>, overrides: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...keep, ...overrides })) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "?";
}

/**
 * Users Directory — Phase 0D final column model (PD-016: this page is the
 * foundation of the production directory, so it stays the shared `DataTable`
 * plus the shared footer, not a one-off).
 *
 * Twelve columns: Name · Email · Phone (+ WhatsApp) · Organization · City ·
 * Verification · Registered · Status · Last active · Profile completion ·
 * Flags · Actions.
 *
 * Real: `listUsers()`, `previewUsersDirectoryContext()` (organization,
 * verification, profile id), `user.status`. Fixture, marked with `PREVIEW_MARK`
 * on the header and one `PreviewLegend` below the toolbar: email/phone/city,
 * profile completeness (the real engine needs `individual_onboarding`, which is
 * self-select-only RLS), the duplicate flag, and the *displayed* Registered
 * date (varied so a correct sort is visually verifiable; real dates untouched).
 *
 * The eye icon means **View on platform**: the public profile at
 * `/p/[profileId]` in a new tab. It is keyed by PROFILE id (a user id there is
 * a guaranteed 404) and is disabled unless `profile_public_directory` says the
 * page will actually render. **Manage** opens the Admin details page.
 */
export default async function PreviewUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    verification?: string;
    city?: string;
    flag?: string;
    page?: string;
    pageSize?: string;
    sort?: string;
  }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q, status, type, verification, city, flag, page: pageParam, pageSize: pageSizeParam, sort } = await searchParams;

  const allUsers = await listUsers(supabase, q);
  const context = await previewUsersDirectoryContext(supabase, allUsers.map((u) => u.id));

  const rows: Row[] = allUsers.map((u) => {
    const ctx = context.get(u.id);
    const { email, phone } = previewContactFor(u.id);
    const completeness = previewCompletenessFor(u.id);
    const duplicate = previewUserDuplicateFlag(u.id);
    const verificationStatus = ctx?.latestVerificationStatus ?? null;
    const verificationState: Row["verificationState"] =
      verificationStatus === "rejected"
        ? "rejected"
        : verificationStatus === "approved" || u.isVerified
          ? "verified"
          : verificationStatus === "submitted" || verificationStatus === "under_review"
            ? "pending"
            : "unverified";
    const flags: FlagCode[] = [];
    if (duplicate) flags.push("possible_duplicate");
    if (completeness < 70) flags.push("incomplete_critical_profile");
    if (verificationState === "rejected") flags.push("verification_issue");
    return {
      ...u,
      email,
      phone,
      city: previewCityFor(u.id),
      completeness,
      duplicate,
      orgId: ctx?.primaryOrgId ?? null,
      orgName: ctx?.primaryOrgName ?? null,
      orgCount: ctx?.orgCount ?? 0,
      verificationStatus,
      verificationState,
      flags,
      registeredAt: previewRegisteredAt(u.id, u.createdAt),
      profileId: ctx?.profileId ?? null,
      publicProfileAvailable: ctx?.publicProfileAvailable ?? false,
    };
  });

  const tabValue = (r: Row) => {
    if (r.status === "suspended") return "suspended";
    if (r.verificationStatus === "rejected") return "rejected";
    if (r.status === "active") return "verified";
    if (r.status === "pending_verification") return "pending";
    return "";
  };
  const tabCounts = { pending: 0, verified: 0, suspended: 0, rejected: 0 };
  for (const r of rows) {
    const v = tabValue(r);
    if (v && v in tabCounts) tabCounts[v as keyof typeof tabCounts]++;
  }
  const duplicateCount = rows.filter((r) => r.duplicate).length;
  const incompleteCount = rows.filter((r) => r.completeness < 70).length;

  let filtered = rows.filter((r) => !status || tabValue(r) === status);
  if (type) filtered = filtered.filter((r) => r.accountType === type);
  if (verification) filtered = filtered.filter((r) => r.verificationState === verification);
  if (city) filtered = filtered.filter((r) => r.city === city);
  if (flag === "duplicate") filtered = filtered.filter((r) => r.duplicate);
  if (flag === "incomplete") filtered = filtered.filter((r) => r.completeness < 70);

  // ONE sort state, parsed against the declared fields only. Registered and
  // Profile Completion each own their column; neither ever reads the other's
  // direction. Default (no `?sort=`) is Registered, newest first.
  const sortState = parseSort(sort, ["registered", "completeness"] as const) ?? { field: "registered" as const, dir: "desc" as const };
  filtered = sortRows(
    filtered,
    sortState.dir,
    sortState.field === "registered" ? (r) => new Date(r.registeredAt).getTime() : (r) => r.completeness,
    (r) => r.id,
  );

  const pageSize = clampPageSize(pageSizeParam);
  const slice = paginate(filtered, pageParam, pageSize);

  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const verificationStateLabels = m.admin.preview.users.verificationState;
  const flagLabels = m.admin.preview.users.flagLabels;
  const cols = m.admin.preview.users.columns;
  const rowActionLabels = m.admin.preview.users.rowActions;
  const warnings = m.admin.preview.users.warnings;
  const platform = m.admin.preview.platformView;
  const keep = { q, status, type, verification, city, flag, pageSize: pageSizeParam, sort };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: cols.name,
      minWidth: "15rem",
      grow: true,
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <RecordCell
            wrap
            title={u.displayName || m.admin.users.unnamed}
            href={`/admin/preview/users/${u.id}`}
            avatar={<Monogram name={u.displayName || "?"} size={28} />}
          />
          {u.flags.length > 0 ? (
            <span title={u.flags.map((f) => flagLabels[f]).join(", ")} aria-hidden="true" className="shrink-0 text-warning">
              ●
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "email",
      header: `${cols.email}${PREVIEW_MARK}`,
      minWidth: "16rem",
      nowrap: true,
      secondary: true,
      cell: (u) => <span dir="ltr" className="text-label">{u.email}</span>,
    },
    {
      key: "phone",
      header: `${cols.phone}${PREVIEW_MARK}`,
      minWidth: "11rem",
      nowrap: true,
      cell: (u) => (
        <span className="flex items-center gap-1.5">
          <span dir="ltr" className="text-label">{u.phone}</span>
          <RowIconLink
            href={whatsappShareUrl({ phone: u.phone, message: `Hi ${u.displayName || ""}` })}
            label={rowActionLabels.whatsapp}
            Icon={WhatsAppIcon}
            tone="success"
            external
          />
        </span>
      ),
    },
    {
      key: "organization",
      header: cols.organization,
      minWidth: "12rem",
      secondary: true,
      cell: (u) =>
        u.orgName ? (
          <RecordCell wrap title={u.orgName} href={u.orgId ? `/admin/preview/organizations/${u.orgId}` : undefined} meta={u.orgCount > 1 ? `+${u.orgCount - 1}` : undefined} />
        ) : (
          <span className="text-fg-muted">{m.admin.preview.users.noOrganization}</span>
        ),
    },
    {
      key: "city",
      header: `${cols.city}${PREVIEW_MARK}`,
      minWidth: "10rem",
      secondary: true,
      cell: (u) => u.city,
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
      header: <SortableHeader field="registered" label={`${cols.registered}${PREVIEW_MARK}`} isDefault />,
      minWidth: "8.5rem",
      nowrap: true,
      secondary: true,
      cell: (u) => formatAdminDate(u.registeredAt, locale),
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
      header: `${cols.lastActive}${PREVIEW_MARK}`,
      minWidth: "8.5rem",
      nowrap: true,
      secondary: true,
      cell: () => <span className="text-fg-muted">{m.admin.preview.users.lastActiveUnavailable}</span>,
    },
    {
      key: "completeness",
      header: <SortableHeader field="completeness" label={`${cols.completeness}${PREVIEW_MARK}`} />,
      minWidth: "9rem",
      nowrap: true,
      secondary: true,
      cell: (u) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-12 overflow-hidden rounded-pill bg-surface-2">
            <span className="block h-full rounded-pill bg-accent-solid" style={{ width: `${u.completeness}%` }} />
          </span>
          <span className="tabular-nums">{formatNumber(u.completeness, locale)}%</span>
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
        if (u.orgId) more.push({ kind: "link", label: rowActionLabels.viewOrg, href: `/admin/preview/organizations/${u.orgId}` });
        more.push({ kind: "link", label: rowActionLabels.addNote, href: `/admin/preview/users/${u.id}?tab=notes` });
        more.push({ kind: "link", label: rowActionLabels.followUp, href: `/admin/preview/users/${u.id}?tab=followup` });
        more.push({ kind: "link", label: rowActionLabels.report, href: `/admin/preview/users/${u.id}?tab=report` });
        more.push({ kind: "link", label: rowActionLabels.audit, href: `/admin/preview/users/${u.id}?tab=audit` });

        return (
          <span className="flex items-center justify-end gap-0.5">
            {/* The eye ALWAYS means "View on platform": the user-facing public
                profile, in a new tab, keyed by PROFILE id. Disabled (never a
                guessed link) when no public destination exists. */}
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
            ) : u.status === "suspended" ? (
              <RowIconAction
                label={rowActionLabels.restore}
                icon={<CheckIcon size={16} />}
                tone="success"
                title={m.admin.preview.users.restoreTitle}
                body={m.admin.preview.users.restoreBody}
                confirmLabel={rowActionLabels.restore}
                confirmVariant="primary"
              />
            ) : (
              <RowIconAction
                label={rowActionLabels.suspend}
                icon={<AlertIcon size={16} />}
                tone="danger"
                title={m.admin.preview.users.suspendTitle}
                body={m.admin.preview.users.suspendBody}
                confirmLabel={rowActionLabels.suspend}
                confirmVariant="danger"
              />
            )}
            <RowActionsMenu label={m.admin.preview.users.moreActions} actions={more} />
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.admin.preview.users.title} subtitle={m.admin.preview.users.detailSubtitle} count={filtered.length} />
      <p className="-mt-2 text-label text-fg-muted">{m.admin.preview.users.previewTotalNote}</p>

      {duplicateCount > 0 || incompleteCount > 0 || tabCounts.pending > 0 ? (
        <Card pad="sm" className="flex flex-col gap-1.5">
          <p className="text-label font-medium text-fg-secondary">{warnings.title}</p>
          <div className="flex flex-wrap gap-sm">
            {tabCounts.pending > 0 ? (
              <a href={filterHref(keep, { status: "pending", page: "" })} className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20">
                {warnings.verificationReview.replace("{count}", formatCount(tabCounts.pending, locale))}
              </a>
            ) : null}
            {duplicateCount > 0 ? (
              <a href={filterHref(keep, { flag: "duplicate", page: "" })} className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20">
                {warnings.duplicates.replace("{count}", formatCount(duplicateCount, locale))}
              </a>
            ) : null}
            {incompleteCount > 0 ? (
              <a href={filterHref(keep, { flag: "incomplete", page: "" })} className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20">
                {warnings.incompleteProfiles.replace("{count}", formatCount(incompleteCount, locale))}
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      <TabLinks
        basePath="/admin/preview/users"
        param="status"
        current={status ?? ""}
        locale={locale}
        keep={keep}
        label={m.admin.preview.users.statusTabs.all}
        tabs={[
          { value: "", label: m.admin.preview.users.statusTabs.all, count: rows.length },
          { value: "pending", label: m.admin.preview.users.statusTabs.pending, count: tabCounts.pending },
          { value: "verified", label: m.admin.preview.users.statusTabs.verified, count: tabCounts.verified },
          { value: "suspended", label: m.admin.preview.users.statusTabs.suspended, count: tabCounts.suspended },
          { value: "rejected", label: m.admin.preview.users.statusTabs.rejected, count: tabCounts.rejected },
        ]}
      />

      <AutoFilters
        fields={[
          { kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder },
          {
            kind: "select",
            name: "type",
            anyLabel: m.admin.preview.users.anyType,
            options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
          },
          {
            kind: "select",
            name: "verification",
            anyLabel: m.admin.preview.users.anyVerification,
            options: (["unverified", "pending", "verified", "rejected"] as const).map((v) => ({ value: v, label: verificationStateLabels[v] })),
          },
          {
            kind: "select",
            name: "city",
            anyLabel: m.admin.preview.users.anyCity,
            options: PREVIEW_CITIES.map((c) => ({ value: c, label: c })),
          },
        ]}
      />

      <PreviewLegend>{m.admin.preview.previewFieldNote}</PreviewLegend>
      <p className="-mt-2 text-label text-fg-muted">{m.admin.preview.users.registeredVariationNote}</p>

      {filtered.length === 0 ? (
        <StatePanel title={m.admin.preview.users.empty} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={slice.rows}
            rowKey={(u) => u.id}
            caption={m.admin.preview.users.title}
            minWidth="90rem"
            stackBelow="desktop"
            empty={<StatePanel title={m.admin.preview.users.empty} />}
          />
          <TablePagination {...slice} pageSize={pageSize} />
        </>
      )}
    </div>
  );
}
