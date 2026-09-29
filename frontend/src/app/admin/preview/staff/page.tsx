import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { previewAdminStaff } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatCount } from "@/lib/ui/format";
import {
  previewContactFor,
  PREVIEW_ROLES,
  PREVIEW_RESOURCES,
  PREVIEW_RESOURCE_ACTIONS,
  PREVIEW_PERMISSION_KEYS,
  PREVIEW_SCOPES,
  rolesHolding,
  isLockedPermission,
  type PreviewRole,
} from "@/features/admin-preview/fixtures";
import { AdminHeader } from "@/features/admin/parts";
import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { TabLinks } from "@/components/ui/stat-tiles";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { LabeledField, Input, Select, Textarea } from "@/components/ui/controls";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { clampPageSize, paginate } from "@/features/admin-preview/table-state";
import type { AdminStaffRow } from "@/server/queries/admin-preview";

export const dynamic = "force-dynamic";

type TabKey = "staff" | "roles" | "permissions";

/**
 * Admin Staff · Roles · Permissions — PD-008 (approved 2026-09-29: adapt CRM
 * Dynamic RBAC to Aladdin), PREVIEW ONLY.
 *
 * This page replaces the retired standalone Access page: Admin Staff is the
 * single entry point for access management, hosting three tabs.
 *
 *  - **Admin Staff** — the roster is REAL (`platform_role_grants`, generalized
 *    from the caller's own row under existing RLS). No `status` column exists
 *    yet, so every grant is honestly "Active".
 *  - **Roles** and **Permissions** — the approved `resource.action`
 *    vocabulary and an illustrative set of planned roles from `fixtures.ts`.
 *    The role editor, Duplicate and Archive are Preview dialogs that never
 *    save; nothing here is enforced. The fixed `support ⊆ moderator ⊆
 *    administrator` tiers stay the ONLY enforced authority until BL-018.
 */
export default async function PreviewAdminStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; pageSize?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { tab: tabParam, q, page: pageParam, pageSize: pageSizeParam } = await searchParams;
  const tab: TabKey = tabParam === "roles" || tabParam === "permissions" ? tabParam : "staff";
  const t = m.admin.preview.staff;

  const allStaff = await previewAdminStaff(supabase);
  const roleNames = t.roleNames as Record<string, string>;
  const roleDescriptions = t.roleDescriptions as Record<string, string>;
  const roleLabels = t.roles as Record<string, string>;
  const resourceLabels = t.resources as Record<string, string>;
  const scopeLabels = t.scopes as Record<string, string>;
  const permissionDesc = t.permissionDesc as unknown as Record<string, Record<string, string>>;

  const staffCountByRole = new Map<string, number>();
  for (const s of allStaff) staffCountByRole.set(s.role, (staffCountByRole.get(s.role) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} />
        {tab === "staff" ? (
          <PreviewActionDialog trigger={t.invite} triggerVariant="accent" title={t.inviteTitle} body={t.inviteBody} confirmLabel={t.invite} confirmVariant="accent">
            <LabeledField label={t.nameLabel} htmlFor="invite-name">
              <Input id="invite-name" placeholder={t.nameLabel} />
            </LabeledField>
            <LabeledField label={t.emailLabel} htmlFor="invite-email">
              <Input id="invite-email" type="email" dir="ltr" placeholder="name@aladdin.eg" />
            </LabeledField>
            <LabeledField label={t.roleLabel} htmlFor="invite-role">
              <Select id="invite-role" defaultValue="support">
                {PREVIEW_ROLES.filter((r) => r.status === "active").map((r) => (
                  <option key={r.key} value={r.key}>
                    {roleNames[r.key]}
                  </option>
                ))}
              </Select>
            </LabeledField>
          </PreviewActionDialog>
        ) : tab === "roles" ? (
          <RoleEditorDialog
            trigger={t.rolesTab.create}
            triggerVariant="accent"
            role={null}
            t={t}
            roleNames={roleNames}
            resourceLabels={resourceLabels}
            scopeLabels={scopeLabels}
            permissionDesc={permissionDesc}
          />
        ) : null}
      </div>

      <TabLinks
        basePath="/admin/preview/staff"
        param="tab"
        current={tab === "staff" ? "" : tab}
        locale={locale}
        label={t.title}
        tabs={[
          { value: "", label: t.tabs.staff },
          { value: "roles", label: t.tabs.roles },
          { value: "permissions", label: t.tabs.permissions },
        ]}
      />

      <p role="note" className="-mt-2 rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">
        {t.rbacNote}
      </p>

      {tab === "staff" ? (
        <StaffTab
          allStaff={allStaff}
          q={q}
          pageParam={pageParam}
          pageSizeParam={pageSizeParam}
          locale={locale}
          m={m}
          t={t}
          roleLabels={roleLabels}
        />
      ) : null}

      {tab === "roles" ? (
        <RolesTab
          legend={m.admin.preview.previewFieldNote}
          t={t}
          staffCountByRole={staffCountByRole}
          roleNames={roleNames}
          roleDescriptions={roleDescriptions}
          resourceLabels={resourceLabels}
          scopeLabels={scopeLabels}
          permissionDesc={permissionDesc}
          locale={locale}
        />
      ) : null}

      {tab === "permissions" ? (
        <PermissionsTab
          t={t}
          roleNames={roleNames}
          permissionDesc={permissionDesc}
          resourceLabels={resourceLabels}
          scopeLabels={scopeLabels}
        />
      ) : null}
    </div>
  );
}

type Messages = ReturnType<typeof getMessages>;
type StaffMessages = Messages["admin"]["preview"]["staff"];

function StaffTab({
  allStaff,
  q,
  pageParam,
  pageSizeParam,
  locale,
  m,
  t,
  roleLabels,
}: {
  allStaff: AdminStaffRow[];
  q?: string;
  pageParam?: string;
  pageSizeParam?: string;
  locale: ReturnType<typeof resolveLocale>;
  m: Messages;
  t: StaffMessages;
  roleLabels: Record<string, string>;
}) {
  const query = (q ?? "").trim().toLowerCase();
  const filtered = query ? allStaff.filter((s) => s.displayName.toLowerCase().includes(query)) : allStaff;
  const slice = paginate(filtered, pageParam, clampPageSize(pageSizeParam));

  const columns: Column<AdminStaffRow>[] = [
    {
      key: "name",
      header: t.columns.name,
      minWidth: "14rem",
      grow: true,
      cell: (s) => (
        <RecordCell
          wrap
          title={s.displayName || m.admin.users.unnamed}
          avatar={<Monogram name={s.displayName || "?"} size={28} />}
        />
      ),
    },
    {
      key: "email",
      header: `${t.columns.email}${PREVIEW_MARK}`,
      minWidth: "16rem",
      nowrap: true,
      secondary: true,
      cell: (s) => <span dir="ltr" className="text-label">{previewContactFor(s.userId).email}</span>,
    },
    {
      key: "role",
      header: t.rolesColumn,
      minWidth: "8rem",
      nowrap: true,
      cell: (s) => <Badge tone="accent">{roleLabels[s.role] ?? s.role}</Badge>,
    },
    { key: "status", header: t.columns.status, minWidth: "6rem", nowrap: true, cell: () => <Badge tone="success">{t.statusActive}</Badge> },
    { key: "scope", header: t.columns.scope, minWidth: "8rem", nowrap: true, secondary: true, cell: () => t.scopePlatformWide },
    {
      key: "created",
      header: t.invitedColumn,
      minWidth: "8rem",
      nowrap: true,
      secondary: true,
      cell: (s) => formatAdminDate(s.createdAt, locale),
    },
    {
      key: "lastActive",
      header: `${t.columns.lastActive}${PREVIEW_MARK}`,
      minWidth: "8rem",
      nowrap: true,
      secondary: true,
      cell: () => <span className="text-fg-muted">{m.admin.preview.users.lastActiveUnavailable}</span>,
    },
    {
      key: "actions",
      header: "",
      minWidth: "12rem",
      cell: (s) => {
        const more: RowAction[] = [
          { kind: "link", label: t.viewPermissions, href: "/admin/preview/staff?tab=permissions" },
          { kind: "action", label: t.viewHistory, title: t.viewHistory, confirmLabel: t.viewHistory, confirmVariant: "primary" },
        ];
        return (
          <div className="flex items-center justify-end gap-sm">
            <PreviewActionDialog trigger={t.changeRole} triggerVariant="outline" title={t.changeRoleTitle} confirmLabel={t.changeRole} confirmVariant="accent">
              <LabeledField label={t.roleLabel} htmlFor={`role-${s.userId}`}>
                <Select id={`role-${s.userId}`} defaultValue={s.role}>
                  {PREVIEW_ROLES.filter((r) => r.status === "active").map((r) => (
                    <option key={r.key} value={r.key}>
                      {(t.roleNames as Record<string, string>)[r.key]}
                    </option>
                  ))}
                </Select>
              </LabeledField>
            </PreviewActionDialog>
            <PreviewActionDialog trigger={t.disable} triggerVariant="danger" title={t.disableTitle} body={t.disableBody} confirmLabel={t.disable} confirmVariant="danger" />
            <RowActionsMenu label={t.title} actions={more} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />
      <PreviewLegend>{m.admin.preview.previewFieldNote}</PreviewLegend>
      <DataTable
        columns={columns}
        rows={slice.rows}
        rowKey={(s) => s.userId}
        caption={t.title}
        minWidth="64rem"
        stackBelow="desktop"
        empty={<StatePanel title={m.admin.preview.duplicates.none} />}
      />
      {filtered.length > 0 ? <TablePagination {...slice} pageSize={clampPageSize(pageSizeParam)} /> : null}
    </>
  );
}

function RolesTab({
  legend,
  t,
  staffCountByRole,
  roleNames,
  roleDescriptions,
  resourceLabels,
  scopeLabels,
  permissionDesc,
  locale,
}: {
  legend: string;
  t: StaffMessages;
  staffCountByRole: Map<string, number>;
  roleNames: Record<string, string>;
  roleDescriptions: Record<string, string>;
  resourceLabels: Record<string, string>;
  scopeLabels: Record<string, string>;
  permissionDesc: Record<string, Record<string, string>>;
  locale: ReturnType<typeof resolveLocale>;
}) {
  const columns: Column<PreviewRole>[] = [
    {
      key: "name",
      header: t.rolesTab.columns.name,
      minWidth: "14rem",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg">{roleNames[r.key]}</span>
          <Badge tone={r.system ? "neutral" : "accent"}>{r.system ? t.rolesTab.system : t.rolesTab.custom}</Badge>
        </span>
      ),
    },
    { key: "description", header: t.rolesTab.columns.description, minWidth: "20rem", grow: true, cell: (r) => <span className="text-fg-secondary">{roleDescriptions[r.key]}</span> },
    { key: "rank", header: t.rolesTab.columns.rank, minWidth: "5rem", nowrap: true, numeric: true, cell: (r) => formatCount(r.rank, locale) },
    {
      key: "staff",
      header: `${t.rolesTab.columns.staffCount}${PREVIEW_MARK}`,
      minWidth: "5rem",
      nowrap: true,
      numeric: true,
      cell: (r) => formatCount(r.realTier ? (staffCountByRole.get(r.realTier) ?? 0) : 0, locale),
    },
    { key: "scope", header: t.rolesTab.columns.scope, minWidth: "7rem", nowrap: true, secondary: true, cell: (r) => scopeLabels[r.scope] },
    {
      key: "status",
      header: t.rolesTab.columns.status,
      minWidth: "6rem",
      nowrap: true,
      cell: (r) => (
        <Badge tone={r.status === "active" ? "success" : "neutral"}>
          {r.status === "active" ? t.rolesTab.statusActive : t.rolesTab.statusArchived}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      minWidth: "13rem",
      cell: (r) => {
        const more: RowAction[] = [
          {
            kind: "action",
            label: t.rolesTab.duplicate,
            title: t.rolesTab.duplicate,
            confirmLabel: t.rolesTab.duplicate,
            confirmVariant: "primary",
          },
        ];
        if (!r.system) {
          more.push({
            kind: "action",
            label: t.rolesTab.archive,
            title: `${t.rolesTab.archive} · ${roleNames[r.key]}`,
            body: t.rolesTab.archiveBody,
            confirmLabel: t.rolesTab.archive,
            confirmVariant: "danger",
            tone: "danger",
          });
        }
        return (
          <div className="flex items-center justify-end gap-sm">
            <RoleEditorDialog
              trigger={t.rolesTab.edit}
              triggerVariant="outline"
              role={r}
              description={roleDescriptions[r.key]}
              t={t}
              roleNames={roleNames}
              resourceLabels={resourceLabels}
              scopeLabels={scopeLabels}
              permissionDesc={permissionDesc}
            />
            <RowActionsMenu label={roleNames[r.key] ?? ""} actions={more} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PreviewLegend>{legend}</PreviewLegend>
      <DataTable
        columns={columns}
        rows={PREVIEW_ROLES}
        rowKey={(r) => r.key}
        caption={t.tabs.roles}
        minWidth="62rem"
        stackBelow="desktop"
        empty={<StatePanel title={t.tabs.roles} />}
      />
    </>
  );
}

function PermissionsTab({
  t,
  roleNames,
  permissionDesc,
  resourceLabels,
  scopeLabels,
}: {
  t: StaffMessages;
  roleNames: Record<string, string>;
  permissionDesc: Record<string, Record<string, string>>;
  resourceLabels: Record<string, string>;
  scopeLabels: Record<string, string>;
}) {
  const rows = PREVIEW_PERMISSION_KEYS.map((key) => {
    const [resource, action] = key.split(".") as [string, string];
    return { key, resource, action };
  });
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "permission",
      header: t.permissionsTab.columns.permission,
      minWidth: "14rem",
      nowrap: true,
      cell: (p) => (
        <span className="flex flex-col">
          <code dir="ltr" className="text-label font-medium text-fg">{p.key}</code>
          <span className="text-label text-fg-muted">{resourceLabels[p.resource]}</span>
        </span>
      ),
    },
    { key: "description", header: t.permissionsTab.columns.description, minWidth: "20rem", grow: true, cell: (p) => permissionDesc[p.resource]?.[p.action] ?? "—" },
    {
      key: "roles",
      header: t.permissionsTab.columns.roles,
      minWidth: "16rem",
      cell: (p) => (
        <span className="flex flex-wrap gap-1">
          {rolesHolding(p.key).map((rk) => (
            <Badge key={rk} tone="neutral">
              {roleNames[rk]}
            </Badge>
          ))}
        </span>
      ),
    },
  ];

  return (
    <>
      <p className="text-body text-fg-secondary">{t.permissionsTab.intro}</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.key}
        caption={t.tabs.permissions}
        minWidth="52rem"
        stackBelow="desktop"
        empty={<StatePanel title={t.tabs.permissions} />}
      />
      <section aria-labelledby="scopes-title" className="flex flex-col gap-sm">
        <h2 id="scopes-title" className="text-title text-fg">{t.scopes.title}</h2>
        <ul className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-5">
          {PREVIEW_SCOPES.map((s) => (
            <li key={s}>
              <Card pad="sm" className="h-full">
                <p className="text-body font-medium text-fg">{scopeLabels[s]}</p>
                <p className="mt-0.5 text-label text-fg-muted">{scopeLabels[`${s}Desc`]}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** The role editor: name, description, rank, scope and `resource.action` permissions grouped by resource. Never saves. */
function RoleEditorDialog({
  trigger,
  triggerVariant,
  role,
  description = "",
  t,
  roleNames,
  resourceLabels,
  scopeLabels,
  permissionDesc,
}: {
  trigger: string;
  triggerVariant: "outline" | "accent";
  role: PreviewRole | null;
  description?: string;
  t: StaffMessages;
  roleNames: Record<string, string>;
  resourceLabels: Record<string, string>;
  scopeLabels: Record<string, string>;
  permissionDesc: Record<string, Record<string, string>>;
}) {
  const id = role ? `role-${role.key}` : "role-new";
  return (
    <PreviewActionDialog
      wide
      trigger={trigger}
      triggerVariant={triggerVariant}
      title={t.rolesTab.editorTitle}
      body={t.rolesTab.editorBody}
      confirmLabel={t.rolesTab.save}
      confirmVariant="accent"
    >
      {role?.system ? <p className="text-label text-fg-muted">{t.rolesTab.lockedNote}</p> : null}
      <div className="grid gap-md tablet:grid-cols-2">
        <LabeledField label={t.rolesTab.nameLabel} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} defaultValue={role ? roleNames[role.key] : ""} placeholder={t.rolesTab.nameLabel} />
        </LabeledField>
        <LabeledField label={t.rolesTab.rankLabel} htmlFor={`${id}-rank`} hint={t.rolesTab.rankHint}>
          <Input id={`${id}-rank`} type="number" min={1} max={99} defaultValue={role?.rank ?? 30} />
        </LabeledField>
      </div>
      <LabeledField label={t.rolesTab.descriptionLabel} htmlFor={`${id}-desc`}>
        <Textarea id={`${id}-desc`} rows={2} defaultValue={description} />
      </LabeledField>
      <LabeledField label={t.rolesTab.scopeLabel} htmlFor={`${id}-scope`}>
        <Select id={`${id}-scope`} defaultValue={role?.scope ?? "platform"}>
          {PREVIEW_SCOPES.map((s) => (
            <option key={s} value={s}>
              {scopeLabels[s]}
            </option>
          ))}
        </Select>
      </LabeledField>
      <fieldset className="flex flex-col gap-sm">
        <legend className="mb-1 text-label font-medium text-fg-secondary">{t.rolesTab.permissionsLabel}</legend>
        {PREVIEW_RESOURCES.map((resource) => (
          <div key={resource} className="rounded-sm border p-sm">
            <p className="mb-1 text-label font-medium text-fg">{resourceLabels[resource]}</p>
            <div className="flex flex-wrap gap-x-md gap-y-1">
              {PREVIEW_RESOURCE_ACTIONS[resource].map((action) => {
                const key = `${resource}.${action}`;
                if (isLockedPermission(role, key)) {
                  // A core permission of a system role: shown, but NOT editable — no checkbox exists to untick.
                  return (
                    <span
                      key={key}
                      role="img"
                      aria-label={`${key} — ${t.rolesTab.lockedPermission}`}
                      title={t.rolesTab.lockedPermission}
                      className="flex cursor-not-allowed items-center gap-1.5 rounded-sm bg-surface-2 px-1.5 py-0.5 text-body text-fg-muted"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="4" y="11" width="16" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      <code dir="ltr" className="text-label">{key}</code>
                    </span>
                  );
                }
                return (
                  <label key={key} className="flex items-center gap-1.5 text-body text-fg-secondary" title={permissionDesc[resource]?.[action]}>
                    <input type="checkbox" defaultChecked={role?.permissions.includes(key) ?? false} className="h-4 w-4 accent-[var(--color-accent-solid)]" />
                    <code dir="ltr" className="text-label">{key}</code>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>
    </PreviewActionDialog>
  );
}
