import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatCount } from "@/lib/ui/format";
import { can, type AdminAccess } from "@/lib/permissions/admin";
import { requireAdminRoute } from "@/server/authorization/admin";
import {
  listAdminPermissions,
  listAdminRoles,
  listAdminStaff,
  withAccountEmails,
  type AdminPermissionRow,
  type AdminRoleRow,
  type AdminStaffMember,
} from "@/server/queries/admin-rbac";
import {
  assignRoleAction,
  changeStaffRoleAction,
  setRoleArchivedAction,
  setStaffDisabledAction,
  unassignRoleAction,
} from "@/server/actions/admin-rbac";
import { assignableRoles, canEditRole, canManageMember } from "@/features/admin-rbac/eligibility";
import { RoleEditor } from "@/features/admin-rbac/role-editor";
import type { Messages, StaffMessages } from "@/features/admin-rbac/types";
import { AdminHeader } from "@/features/admin/parts";
import { Badge, Card, StatePanel } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { TabLinks } from "@/components/ui/stat-tiles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { LabeledField, Input, Select } from "@/components/ui/controls";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { clampPageSize, paginate } from "@/features/admin-preview/table-state";

export const dynamic = "force-dynamic";

type TabKey = "staff" | "roles" | "permissions";

/**
 * Admin Staff · Roles · Permissions — Admin Core 1A (PD-008, PD-016).
 *
 * Every row is REAL: the roster, roles and catalog come from the self-guarding
 * `admin_rbac_*` RPCs over `admin_role_assignments` / `admin_roles` /
 * `admin_permissions`. Every control is a REAL mutation through a server action
 * → RPC that re-checks the permission, the rank/permission ceilings, the
 * no-self-management and last-Super-Admin rules, and writes the audit trail.
 * Controls are drawn only when the caller is eligible (features/admin-rbac/
 * eligibility.ts) — presentation only; the RPC is the boundary.
 *
 * Still Preview: "Invite Admin Staff" (onboarding a person with no Admin history
 * is the separate Invitation sub-phase), and scoped (organization / branch /
 * user) role creation and assignment, whose scope picker belongs to Phase 1B.
 */
export default async function AdminStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; pageSize?: string }>;
}) {
  const access = await requireAdminRoute("/admin/preview/staff");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = m.admin.preview.staff;
  const { tab: tabParam, q, page: pageParam, pageSize: pageSizeParam } = await searchParams;

  // Tabs the caller may open; an unpermitted ?tab= falls back to the first allowed.
  const allowed: TabKey[] = [
    ...(can(access, "admin_staff.read") ? (["staff"] as const) : []),
    ...(can(access, "roles.read") ? (["roles", "permissions"] as const) : []),
  ];
  const requested = (tabParam || "staff") as TabKey;
  const tab: TabKey = allowed.includes(requested) ? requested : allowed[0]!;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const callerId = user?.id ?? "";

  const [staff, roles, catalog] = await Promise.all([
    tab === "staff" ? listAdminStaff(supabase).then((rows) => (rows ? withAccountEmails(supabase, access, rows) : rows)) : Promise.resolve(null),
    // The Staff tab needs roles for its "Change role" options (roles.read);
    // Roles/Permissions need them for their rows.
    can(access, "roles.read") ? listAdminRoles(supabase) : Promise.resolve(null),
    tab !== "staff" ? listAdminPermissions(supabase) : Promise.resolve(null),
  ]);

  const roleNames = t.roleNames as Record<string, string>;
  const roleDescriptions = t.roleDescriptions as Record<string, string>;
  const resourceLabels = t.resources as Record<string, string>;
  const scopeLabels = t.scopes as Record<string, string>;
  const permissionDesc = t.permissionDesc as unknown as Record<string, Record<string, string>>;
  const nameOf = (r: { key: string; name: string; isSystem: boolean }) => (r.isSystem ? (roleNames[r.key] ?? r.name) : r.name);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} />
        {tab === "staff" && can(access, "admin_staff.manage") ? (
          <PreviewActionDialog trigger={t.invite} triggerVariant="accent" title={t.inviteTitle} body={t.inviteBody} confirmLabel={t.invite} confirmVariant="accent">
            <LabeledField label={t.nameLabel} htmlFor="invite-name">
              <Input id="invite-name" placeholder={t.nameLabel} />
            </LabeledField>
            <LabeledField label={t.emailLabel} htmlFor="invite-email">
              <Input id="invite-email" type="email" dir="ltr" placeholder="name@aladdin.eg" />
            </LabeledField>
          </PreviewActionDialog>
        ) : tab === "roles" && can(access, "roles.manage") && catalog ? (
          <RoleEditor
            role={null}
            displayName=""
            displayDescription=""
            catalog={catalog}
            held={access.permissions}
            actorRank={access.rank}
            t={t}
            resourceLabels={resourceLabels}
            permissionDesc={permissionDesc}
            scopeLabels={scopeLabels}
          />
        ) : null}
      </div>

      <TabLinks
        basePath="/admin/preview/staff"
        param="tab"
        current={tab === "staff" ? "" : tab}
        locale={locale}
        label={t.title}
        tabs={allowed.map((k) => ({ value: k === "staff" ? "" : k, label: t.tabs[k] }))}
      />

      <p role="note" className="-mt-2 rounded-sm border border-info/40 bg-info/10 px-md py-2 text-label text-fg-secondary">
        {t.rbacNote}
      </p>

      {tab === "staff" ? (
        staff === null ? (
          <StatePanel title={t.notAuthorizedTab} />
        ) : (
          <StaffTab
            staff={staff}
            roles={roles ?? []}
            access={access}
            callerId={callerId}
            q={q}
            pageParam={pageParam}
            pageSizeParam={pageSizeParam}
            locale={locale}
            m={m}
            t={t}
            nameOf={nameOf}
          />
        )
      ) : null}

      {tab === "roles" ? (
        roles === null || catalog === null ? (
          <StatePanel title={t.notAuthorizedTab} />
        ) : (
          <RolesTab
            roles={roles}
            catalog={catalog}
            access={access}
            t={t}
            locale={locale}
            nameOf={nameOf}
            roleDescriptions={roleDescriptions}
            resourceLabels={resourceLabels}
            scopeLabels={scopeLabels}
            permissionDesc={permissionDesc}
          />
        )
      ) : null}

      {tab === "permissions" ? (
        roles === null || catalog === null ? (
          <StatePanel title={t.notAuthorizedTab} />
        ) : (
          <PermissionsTab
            roles={roles}
            catalog={catalog}
            t={t}
            nameOf={nameOf}
            permissionDesc={permissionDesc}
            resourceLabels={resourceLabels}
            scopeLabels={scopeLabels}
          />
        )
      ) : null}
    </div>
  );
}

type NameOf = (r: { key: string; name: string; isSystem: boolean }) => string;

function StaffTab({
  staff,
  roles,
  access,
  callerId,
  q,
  pageParam,
  pageSizeParam,
  locale,
  m,
  t,
  nameOf,
}: {
  staff: AdminStaffMember[];
  roles: AdminRoleRow[];
  access: AdminAccess;
  callerId: string;
  q?: string;
  pageParam?: string;
  pageSizeParam?: string;
  locale: ReturnType<typeof resolveLocale>;
  m: Messages;
  t: StaffMessages;
  nameOf: NameOf;
}) {
  const query = (q ?? "").trim().toLowerCase();
  const filtered = query
    ? staff.filter((s) => s.displayName.toLowerCase().includes(query) || (s.email ?? "").toLowerCase().includes(query))
    : staff;
  const slice = paginate(filtered, pageParam, clampPageSize(pageSizeParam));
  const offer = assignableRoles(access, roles);
  const manages = can(access, "admin_staff.manage");

  const columns: Column<AdminStaffMember>[] = [
    {
      key: "name",
      header: t.columns.name,
      minWidth: "14rem",
      grow: true,
      cell: (s) => (
        <RecordCell
          wrap
          title={s.displayName || m.admin.users.unnamed}
          meta={s.userId === callerId ? <Badge tone="neutral">{t.you}</Badge> : undefined}
          avatar={<Monogram name={s.displayName || "?"} size={28} />}
        />
      ),
    },
    {
      key: "email",
      header: t.columns.email,
      minWidth: "14rem",
      nowrap: true,
      secondary: true,
      cell: (s) => (s.email ? <span dir="ltr" className="text-label">{s.email}</span> : <span className="text-fg-muted">—</span>),
    },
    {
      key: "role",
      header: t.rolesColumn,
      minWidth: "10rem",
      cell: (s) => {
        const active = s.assignments.filter((a) => a.isActive);
        return active.length ? (
          <span className="flex flex-wrap gap-1">
            {active.map((a) => (
              <Badge key={a.id} tone={a.roleStatus === "archived" ? "neutral" : "accent"}>
                {nameOf({ key: a.roleKey, name: a.roleName, isSystem: a.isSystem })}
                {a.scopeType !== "platform" && a.scopeOrganizationName ? ` · ${a.scopeOrganizationName}` : ""}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        );
      },
    },
    {
      key: "status",
      header: t.columns.status,
      minWidth: "6rem",
      nowrap: true,
      cell: (s) => (s.isActive ? <Badge tone="success">{t.statusActive}</Badge> : <Badge tone="neutral">{t.statusDisabled}</Badge>),
    },
    {
      key: "created",
      header: t.invitedColumn,
      minWidth: "8rem",
      nowrap: true,
      secondary: true,
      cell: (s) => formatAdminDate(s.firstAssignedAt, locale),
    },
    {
      key: "lastActive",
      header: t.columns.lastActive,
      minWidth: "8rem",
      nowrap: true,
      secondary: true,
      cell: (s) => (s.lastSignInAt ? formatAdminDate(s.lastSignInAt, locale) : <span className="text-fg-muted">{t.neverSignedIn}</span>),
    },
    {
      key: "actions",
      header: "",
      minWidth: "16rem",
      cell: (s) => {
        if (!canManageMember(access, callerId, s)) return null;
        const active = s.assignments.filter((a) => a.isActive);
        const current = active.find((a) => a.scopeType === "platform");
        const addable = offer.filter((r) => !active.some((a) => a.roleId === r.id));
        return (
          <div className="flex flex-wrap items-center justify-end gap-sm">
            {s.isActive && offer.length ? (
              <ConfirmDialog
                trigger={t.changeRole}
                triggerVariant="outline"
                title={t.changeRoleTitle}
                body={t.changeRoleBody}
                confirmLabel={t.changeRole}
                confirmVariant="accent"
                formAction={changeStaffRoleAction}
              >
                <input type="hidden" name="userId" value={s.userId} />
                <LabeledField label={t.roleLabel} htmlFor={`change-${s.userId}`}>
                  <Select id={`change-${s.userId}`} name="roleId" defaultValue={current?.roleId ?? offer[0]!.id}>
                    {offer.map((r) => (
                      <option key={r.id} value={r.id}>
                        {nameOf(r)}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <ReasonField id={`change-reason-${s.userId}`} label={t.reasonOptional} />
              </ConfirmDialog>
            ) : null}
            {s.isActive && addable.length ? (
              <ConfirmDialog
                trigger={t.addRole}
                triggerVariant="ghost"
                title={t.addRoleTitle}
                body={t.addRoleBody}
                confirmLabel={t.addRole}
                confirmVariant="accent"
                formAction={assignRoleAction}
              >
                <input type="hidden" name="userId" value={s.userId} />
                <LabeledField label={t.roleLabel} htmlFor={`add-${s.userId}`}>
                  <Select id={`add-${s.userId}`} name="roleId" defaultValue={addable[0]!.id}>
                    {addable.map((r) => (
                      <option key={r.id} value={r.id}>
                        {nameOf(r)}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <ReasonField id={`add-reason-${s.userId}`} label={t.reasonOptional} />
              </ConfirmDialog>
            ) : null}
            {active.length > 1 ? (
              <ConfirmDialog
                trigger={t.removeRole}
                triggerVariant="ghost"
                title={t.removeRoleTitle}
                body={t.removeRoleBody}
                confirmLabel={t.removeRole}
                confirmVariant="danger"
                formAction={unassignRoleAction}
              >
                <LabeledField label={t.roleLabel} htmlFor={`remove-${s.userId}`}>
                  <Select id={`remove-${s.userId}`} name="assignmentId" defaultValue={active[active.length - 1]!.id}>
                    {active.map((a) => (
                      <option key={a.id} value={a.id}>
                        {nameOf({ key: a.roleKey, name: a.roleName, isSystem: a.isSystem })}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <ReasonField id={`remove-reason-${s.userId}`} label={t.reasonOptional} />
              </ConfirmDialog>
            ) : null}
            {manages ? (
              <ConfirmDialog
                trigger={s.isActive ? t.disable : t.restore}
                triggerVariant={s.isActive ? "danger" : "outline"}
                title={s.isActive ? t.disableTitle : t.restoreTitle}
                body={s.isActive ? t.disableBody : t.restoreBody}
                confirmLabel={s.isActive ? t.disable : t.restore}
                confirmVariant={s.isActive ? "danger" : "accent"}
                formAction={setStaffDisabledAction}
              >
                <input type="hidden" name="userId" value={s.userId} />
                <input type="hidden" name="disabled" value={s.isActive ? "true" : "false"} />
                <ReasonField id={`disable-reason-${s.userId}`} label={s.isActive ? t.reasonLabel : t.reasonOptional} required={s.isActive} />
              </ConfirmDialog>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      {!manages ? <p className="text-label text-fg-muted">{t.readOnlyNote}</p> : null}
      <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />
      <DataTable
        columns={columns}
        rows={slice.rows}
        rowKey={(s) => s.userId}
        caption={t.title}
        minWidth="68rem"
        stackBelow="desktop"
        empty={<StatePanel title={m.admin.preview.duplicates.none} />}
      />
      {filtered.length > 0 ? <TablePagination {...slice} pageSize={clampPageSize(pageSizeParam)} /> : null}
    </>
  );
}

function ReasonField({ id, label, required = false }: { id: string; label: string; required?: boolean }) {
  return (
    <LabeledField label={label} htmlFor={id}>
      <Input id={id} name="reason" maxLength={500} required={required} />
    </LabeledField>
  );
}

function RolesTab({
  roles,
  catalog,
  access,
  t,
  locale,
  nameOf,
  roleDescriptions,
  resourceLabels,
  scopeLabels,
  permissionDesc,
}: {
  roles: AdminRoleRow[];
  catalog: AdminPermissionRow[];
  access: AdminAccess;
  t: StaffMessages;
  locale: ReturnType<typeof resolveLocale>;
  nameOf: NameOf;
  roleDescriptions: Record<string, string>;
  resourceLabels: Record<string, string>;
  scopeLabels: Record<string, string>;
  permissionDesc: Record<string, Record<string, string>>;
}) {
  const describe = (r: AdminRoleRow) => (r.isSystem ? (roleDescriptions[r.key] ?? r.description) : r.description);
  const columns: Column<AdminRoleRow>[] = [
    {
      key: "name",
      header: t.rolesTab.columns.name,
      minWidth: "14rem",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg">{nameOf(r)}</span>
          <Badge tone={r.isSystem ? "neutral" : "accent"}>{r.isSystem ? t.rolesTab.system : t.rolesTab.custom}</Badge>
        </span>
      ),
    },
    { key: "description", header: t.rolesTab.columns.description, minWidth: "20rem", grow: true, cell: (r) => <span className="text-fg-secondary">{describe(r) || "—"}</span> },
    { key: "rank", header: t.rolesTab.columns.rank, minWidth: "5rem", nowrap: true, numeric: true, cell: (r) => formatCount(r.rank, locale) },
    { key: "staff", header: t.rolesTab.columns.staffCount, minWidth: "5rem", nowrap: true, numeric: true, cell: (r) => formatCount(r.staffCount, locale) },
    { key: "scope", header: t.rolesTab.columns.scope, minWidth: "7rem", nowrap: true, secondary: true, cell: (r) => scopeLabels[r.scopeType] ?? r.scopeType },
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
        if (!canEditRole(access, r)) return null;
        return (
          <div className="flex items-center justify-end gap-sm">
            {r.status === "active" ? (
              <RoleEditor
                role={r}
                displayName={nameOf(r)}
                displayDescription={describe(r)}
                catalog={catalog}
                held={access.permissions}
                actorRank={access.rank}
                t={t}
                resourceLabels={resourceLabels}
                permissionDesc={permissionDesc}
                scopeLabels={scopeLabels}
              />
            ) : null}
            {!r.isSystem ? (
              <ConfirmDialog
                trigger={r.status === "active" ? t.rolesTab.archive : t.rolesTab.restore}
                triggerVariant={r.status === "active" ? "danger" : "outline"}
                title={`${r.status === "active" ? t.rolesTab.archive : t.rolesTab.restore} · ${nameOf(r)}`}
                body={r.status === "active" ? t.rolesTab.archiveBody : t.rolesTab.restoreBody}
                confirmLabel={r.status === "active" ? t.rolesTab.archive : t.rolesTab.restore}
                confirmVariant={r.status === "active" ? "danger" : "accent"}
                formAction={setRoleArchivedAction}
              >
                <input type="hidden" name="roleId" value={r.id} />
                <input type="hidden" name="archived" value={r.status === "active" ? "true" : "false"} />
                <ReasonField id={`archive-reason-${r.id}`} label={t.reasonOptional} />
              </ConfirmDialog>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={roles}
      rowKey={(r) => r.id}
      caption={t.tabs.roles}
      minWidth="62rem"
      stackBelow="desktop"
      empty={<StatePanel title={t.tabs.roles} />}
    />
  );
}

function PermissionsTab({
  roles,
  catalog,
  t,
  nameOf,
  permissionDesc,
  resourceLabels,
  scopeLabels,
}: {
  roles: AdminRoleRow[];
  catalog: AdminPermissionRow[];
  t: StaffMessages;
  nameOf: NameOf;
  permissionDesc: Record<string, Record<string, string>>;
  resourceLabels: Record<string, string>;
  scopeLabels: Record<string, string>;
}) {
  const activeRoles = roles.filter((r) => r.status === "active");
  const columns: Column<AdminPermissionRow>[] = [
    {
      key: "permission",
      header: t.permissionsTab.columns.permission,
      minWidth: "14rem",
      nowrap: true,
      cell: (p) => (
        <span className="flex flex-col">
          <code dir="ltr" className="text-label font-medium text-fg">{p.key}</code>
          <span className="text-label text-fg-muted">{resourceLabels[p.resource] ?? p.resource}</span>
        </span>
      ),
    },
    {
      key: "description",
      header: t.permissionsTab.columns.description,
      minWidth: "20rem",
      grow: true,
      cell: (p) => permissionDesc[p.resource]?.[p.action] ?? p.description,
    },
    {
      key: "roles",
      header: t.permissionsTab.columns.roles,
      minWidth: "16rem",
      cell: (p) => {
        const holders = activeRoles.filter((r) => r.permissions.includes(p.key));
        return holders.length ? (
          <span className="flex flex-wrap gap-1">
            {holders.map((r) => (
              <Badge key={r.id} tone="neutral">
                {nameOf(r)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-fg-muted">{t.permissionsTab.none}</span>
        );
      },
    },
  ];

  return (
    <>
      <p className="text-body text-fg-secondary">{t.permissionsTab.intro}</p>
      <DataTable
        columns={columns}
        rows={catalog}
        rowKey={(p) => p.key}
        caption={t.tabs.permissions}
        minWidth="52rem"
        stackBelow="desktop"
        empty={<StatePanel title={t.tabs.permissions} />}
      />
      <section aria-labelledby="scopes-title" className="flex flex-col gap-sm">
        <h2 id="scopes-title" className="text-title text-fg">{t.scopes.title}</h2>
        <ul className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-5">
          {(["platform", "organization", "branch", "department", "user"] as const).map((s) => (
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
