import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { previewAdminStaff } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatCount } from "@/lib/ui/format";
import { previewContactFor } from "@/features/admin-preview/fixtures";
import { AdminHeader } from "@/features/admin/parts";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, ListFooter, type Column } from "@/components/ui/data-table";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { LabeledField, Input, Select } from "@/components/ui/controls";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import type { AdminStaffRow } from "@/server/queries/admin-preview";

export const dynamic = "force-dynamic";

/**
 * Phase 0B — Admin Staff / Access Management (new page).
 *
 * The roster is REAL: `platform_role_grants` is a genuine, already-queryable
 * table (the same one `loadPlatformRole()` reads for the caller's own row),
 * generalized here to every row under existing RLS. There is no `status`
 * (invited/active/disabled) column in this schema today, so every grant
 * shown is honestly labelled "Active" rather than inventing a lifecycle
 * state the database cannot back yet. Invite / change role / disable /
 * restore are preview-only dialogs — PD-008 keeps dynamic RBAC deferred;
 * this page previews the FIXED-role shape (support/moderator/administrator),
 * never a permission builder. Real grants remain DBA-provisioned.
 */
export default async function PreviewAdminStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q } = await searchParams;
  const allStaff = await previewAdminStaff(supabase);
  const query = (q ?? "").trim().toLowerCase();
  const staff = query ? allStaff.filter((s) => s.displayName.toLowerCase().includes(query)) : allStaff;
  const t = m.admin.preview.staff;
  const roleLabels = t.roles as Record<string, string>;

  const columns: Column<AdminStaffRow>[] = [
    {
      key: "name",
      header: t.columns.name,
      grow: true,
      cell: (s) => (
        <RecordCell
          title={s.displayName || m.admin.users.unnamed}
          avatar={<Monogram name={s.displayName || "?"} size={28} />}
        />
      ),
    },
    {
      key: "email",
      header: `${t.columns.email}${PREVIEW_MARK}`,
      secondary: true,
      cell: (s) => <span dir="ltr" className="truncate text-label">{previewContactFor(s.userId).email}</span>,
    },
    { key: "role", header: t.columns.role, cell: (s) => <Badge tone="accent">{roleLabels[s.role] ?? s.role}</Badge> },
    { key: "status", header: t.columns.status, cell: () => <Badge tone="success">{t.statusActive}</Badge> },
    { key: "scope", header: t.columns.scope, secondary: true, cell: () => t.scopePlatformWide },
    {
      key: "grantedBy",
      header: t.columns.grantedBy,
      secondary: true,
      cell: (s) => s.grantedByName || "—",
    },
    { key: "created", header: t.columns.created, secondary: true, cell: (s) => formatAdminDate(s.createdAt, locale) },
    {
      key: "lastActive",
      header: `${t.columns.lastActive}${PREVIEW_MARK}`,
      secondary: true,
      cell: () => <span className="text-fg-muted">{m.admin.preview.users.lastActiveUnavailable}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (s) => {
        const more: RowAction[] = [
          { kind: "link", label: t.viewPermissions, href: "/admin/preview/access" },
          { kind: "action", label: t.viewHistory, title: t.viewHistory, confirmLabel: t.viewHistory, confirmVariant: "primary" },
        ];
        return (
          <div className="flex flex-wrap items-center justify-end gap-sm">
            <PreviewActionDialog trigger={t.changeRole} triggerVariant="outline" title={t.changeRoleTitle} confirmLabel={t.changeRole} confirmVariant="accent">
              <LabeledField label={t.roleLabel} htmlFor={`role-${s.userId}`}>
                <Select id={`role-${s.userId}`} defaultValue={s.role}>
                  <option value="support">{roleLabels.support}</option>
                  <option value="moderator">{roleLabels.moderator}</option>
                  <option value="administrator">{roleLabels.administrator}</option>
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
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <AdminHeader locale={locale} title={t.title} subtitle={t.subtitle} count={staff.length} />
        <PreviewActionDialog trigger={t.invite} triggerVariant="accent" title={t.inviteTitle} body={t.inviteBody} confirmLabel={t.invite} confirmVariant="accent">
          <LabeledField label={t.nameLabel} htmlFor="invite-name">
            <Input id="invite-name" placeholder={t.nameLabel} />
          </LabeledField>
          <LabeledField label={t.emailLabel} htmlFor="invite-email">
            <Input id="invite-email" type="email" dir="ltr" placeholder="name@aladdin.eg" />
          </LabeledField>
          <LabeledField label={t.roleLabel} htmlFor="invite-role">
            <Select id="invite-role" defaultValue="support">
              <option value="support">{roleLabels.support}</option>
              <option value="moderator">{roleLabels.moderator}</option>
              <option value="administrator">{roleLabels.administrator}</option>
            </Select>
          </LabeledField>
        </PreviewActionDialog>
      </div>

      <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />

      <PreviewLegend>{m.admin.preview.previewFieldNote}</PreviewLegend>

      {staff.length === 0 ? (
        <StatePanel title={m.admin.preview.duplicates.none} />
      ) : (
        <>
          <DataTable columns={columns} rows={staff} rowKey={(s) => s.userId} caption={t.title} empty={<StatePanel title={t.title} />} />
          <ListFooter>{t.title}: {formatCount(staff.length, locale)}</ListFooter>
        </>
      )}
    </div>
  );
}
