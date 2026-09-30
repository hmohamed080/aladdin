import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, LabeledField, Textarea } from "@/components/ui/controls";
import { createRoleAction, updateRoleAction } from "@/server/actions/admin-rbac";
import type { AdminPermissionRow, AdminRoleRow } from "@/server/queries/admin-rbac";
import type { StaffMessages } from "./types";

/**
 * The role editor — create (role = null) or edit. Renders a real form posted to
 * `admin_role_create` / `admin_role_update`; the RPC re-validates everything.
 *
 * The submitted permission set must never silently DROP something the editor
 * could not see or change, so:
 *  - a LOCKED core permission renders as a lock plus a hidden input (kept);
 *  - a permission the editor does NOT hold renders disabled, and if the role
 *    already carries it a hidden input keeps it (the RPC refuses changing it);
 *  - a SYSTEM role's name / description / rank are submitted unchanged (the RPC
 *    refuses any change to them) and shown read-only.
 */
export function RoleEditor({
  role,
  displayName,
  displayDescription,
  catalog,
  held,
  actorRank,
  t,
  resourceLabels,
  permissionDesc,
  scopeLabels,
}: {
  role: AdminRoleRow | null;
  displayName: string;
  displayDescription: string;
  catalog: AdminPermissionRow[];
  /** The editor's own permissions. */
  held: readonly string[];
  actorRank: number;
  t: StaffMessages;
  resourceLabels: Record<string, string>;
  permissionDesc: Record<string, Record<string, string>>;
  scopeLabels: Record<string, string>;
}) {
  const id = role ? `role-${role.id}` : "role-new";
  const system = role?.isSystem ?? false;
  const resources = Array.from(new Set(catalog.map((p) => p.resource)));
  const maxRank = Math.min(99, actorRank - 1);

  return (
    <ConfirmDialog
      wide
      trigger={role ? t.rolesTab.edit : t.rolesTab.create}
      triggerVariant={role ? "outline" : "accent"}
      title={role ? t.rolesTab.editorTitle : t.rolesTab.createTitle}
      body={t.rolesTab.editorBody}
      confirmLabel={t.rolesTab.save}
      confirmVariant="accent"
      formAction={role ? updateRoleAction : createRoleAction}
    >
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
      {/* Scoped (organization / branch / user) roles need a scope picker that
          belongs to the Organizations module (Phase 1B); 1A creates platform roles. */}
      {role ? null : <input type="hidden" name="scope" value="platform" />}
      {system ? <p className="text-label text-fg-muted">{t.rolesTab.lockedNote}</p> : null}

      {system ? (
        <>
          <input type="hidden" name="name" value={role!.name} />
          <input type="hidden" name="description" value={role!.description} />
          <input type="hidden" name="rank" value={role!.rank} />
          <dl className="grid gap-sm tablet:grid-cols-2">
            <div>
              <dt className="text-label text-fg-muted">{t.rolesTab.nameLabel}</dt>
              <dd className="text-body font-medium text-fg">{displayName}</dd>
            </div>
            <div>
              <dt className="text-label text-fg-muted">{t.rolesTab.rankLabel}</dt>
              <dd className="text-body text-fg">{role!.rank}</dd>
            </div>
          </dl>
          <p className="text-body text-fg-secondary">{displayDescription}</p>
        </>
      ) : (
        <>
          <div className="grid gap-md tablet:grid-cols-2">
            <LabeledField label={t.rolesTab.nameLabel} htmlFor={`${id}-name`}>
              <Input id={`${id}-name`} name="name" required maxLength={80} defaultValue={role?.name ?? ""} />
            </LabeledField>
            <LabeledField label={t.rolesTab.rankLabel} htmlFor={`${id}-rank`} hint={t.rolesTab.rankHint}>
              <Input
                id={`${id}-rank`}
                name="rank"
                type="number"
                required
                min={1}
                max={maxRank}
                defaultValue={role?.rank ?? Math.min(30, maxRank)}
              />
            </LabeledField>
          </div>
          <LabeledField label={t.rolesTab.descriptionLabel} htmlFor={`${id}-desc`}>
            <Textarea id={`${id}-desc`} name="description" rows={2} maxLength={500} defaultValue={role?.description ?? ""} />
          </LabeledField>
        </>
      )}

      <div className="flex flex-col gap-0.5">
        <span className="text-label font-medium text-fg-secondary">{t.rolesTab.scopeLabel}</span>
        <span className="text-body text-fg">{scopeLabels[role?.scopeType ?? "platform"]}</span>
        {role ? <span className="text-label text-fg-muted">{t.rolesTab.scopeFixed}</span> : null}
      </div>

      <fieldset className="flex flex-col gap-sm">
        <legend className="mb-1 text-label font-medium text-fg-secondary">{t.rolesTab.permissionsLabel}</legend>
        {resources.map((resource) => (
          <div key={resource} className="rounded-sm border p-sm">
            <p className="mb-1 text-label font-medium text-fg">{resourceLabels[resource] ?? resource}</p>
            <div className="flex flex-wrap gap-x-md gap-y-1">
              {catalog
                .filter((p) => p.resource === resource)
                .map((p) => {
                  const checked = role?.permissions.includes(p.key) ?? false;
                  if (role?.lockedPermissions.includes(p.key)) {
                    return (
                      <span
                        key={p.key}
                        role="img"
                        aria-label={`${p.key} — ${t.rolesTab.lockedPermission}`}
                        title={t.rolesTab.lockedPermission}
                        className="flex cursor-not-allowed items-center gap-1.5 rounded-sm bg-surface-2 px-1.5 py-0.5 text-body text-fg-muted"
                      >
                        <input type="hidden" name="permissions" value={p.key} />
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="4" y="11" width="16" height="10" rx="2" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        <code dir="ltr" className="text-label">{p.key}</code>
                      </span>
                    );
                  }
                  const holds = held.includes(p.key);
                  return (
                    <label
                      key={p.key}
                      className={holds ? "flex items-center gap-1.5 text-body text-fg-secondary" : "flex cursor-not-allowed items-center gap-1.5 text-body text-fg-muted"}
                      title={holds ? (permissionDesc[p.resource]?.[p.action] ?? p.description) : t.rolesTab.notHeld}
                    >
                      {!holds && checked ? <input type="hidden" name="permissions" value={p.key} /> : null}
                      <input
                        type="checkbox"
                        name={holds ? "permissions" : undefined}
                        value={p.key}
                        defaultChecked={checked}
                        disabled={!holds}
                        className="h-4 w-4 accent-[var(--color-accent-solid)]"
                      />
                      <code dir="ltr" className="text-label">{p.key}</code>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </fieldset>

      <LabeledField label={t.reasonOptional} htmlFor={`${id}-reason`}>
        <Input id={`${id}-reason`} name="reason" maxLength={500} />
      </LabeledField>
    </ConfirmDialog>
  );
}
