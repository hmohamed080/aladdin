"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { Button, Input, LabeledField, Select, SubmitButton } from "@/components/ui/controls";
import {
  createStaffInvitationAction,
  revokeStaffInvitationAction,
  type StaffInvitationState,
} from "@/server/actions/staff-invitation";

export type InvitationRowView = {
  id: string;
  emailMasked: string;
  roleName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresLabel: string;
  invitedByName: string;
  inviterAuthorized: boolean;
};
export type InvitableRole = { id: string; name: string };

const initial: StaffInvitationState = { ok: false };
const TONE = { pending: "info", accepted: "success", revoked: "neutral", expired: "warning" } as const;

/** Admin Staff → Invitations: create a one-time invitation, see the roster (masked addresses), withdraw a pending one. */
export function StaffInvitationsPanel({ rows, roles, canManage }: { rows: InvitationRowView[]; roles: InvitableRole[]; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-lg" data-testid="staff-invitations">
      {canManage ? <CreateInvitation roles={roles} /> : null}
      <Card>
        {rows.length === 0 ? (
          <p className="text-body text-fg-muted">{t("staffInvitation.admin.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-body">
              <thead>
                <tr className="text-label text-fg-muted">
                  {(["email", "role", "status", "invitedBy", "expires", "actions"] as const).map((c) => (
                    <th key={c} className="px-sm py-xs text-start font-medium">
                      {t(`staffInvitation.admin.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-sm py-xs" dir="ltr">
                      {r.emailMasked}
                    </td>
                    <td className="px-sm py-xs">{r.roleName}</td>
                    <td className="px-sm py-xs">
                      <Badge tone={TONE[r.status]}>{t(`staffInvitation.admin.status.${r.status}`)}</Badge>
                      {r.status === "pending" && !r.inviterAuthorized ? (
                        <p className="mt-1 text-label text-warning">{t("staffInvitation.admin.inviterUnauthorized")}</p>
                      ) : null}
                    </td>
                    <td className="px-sm py-xs">{r.invitedByName || "—"}</td>
                    <td className="px-sm py-xs">{r.expiresLabel}</td>
                    <td className="px-sm py-xs">{canManage && r.status === "pending" ? <RevokeForm id={r.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CreateInvitation({ roles }: { roles: InvitableRole[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState(createStaffInvitationAction, initial);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  // The one-time token lives only in this component's action state, long enough to be copied. It is never written to storage, the URL or any other page.
  const token = state.ok ? (state.token ?? null) : null;
  const link = token && typeof window !== "undefined" ? `${window.location.origin}/auth/staff-invitation/${token}` : null;
  const copied = token !== null && copiedToken === token;

  return (
    <Card>
      <SectionTitle>{t("staffInvitation.admin.inviteTitle")}</SectionTitle>
      <p className="mt-1 text-body text-fg-secondary">{t("staffInvitation.admin.inviteBody")}</p>
      {roles.length === 0 ? (
        <p className="mt-md text-body text-fg-muted">{t("staffInvitation.admin.noRoles")}</p>
      ) : (
        <form action={action} className="mt-md flex flex-col gap-sm" noValidate>
          <LabeledField label={t("staffInvitation.admin.emailLabel")} htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" dir="ltr" autoComplete="off" required />
          </LabeledField>
          <LabeledField label={t("staffInvitation.admin.roleLabel")} htmlFor="invite-role">
            <Select id="invite-role" name="roleId" defaultValue={roles[0]!.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </LabeledField>
          <LabeledField label={t("staffInvitation.admin.reasonLabel")} htmlFor="invite-reason">
            <Input id="invite-reason" name="reason" type="text" maxLength={500} required />
          </LabeledField>
          {state.code && !state.ok ? (
            <p role="alert" className="text-label text-danger">
              {t(state.code)}
            </p>
          ) : null}
          <SubmitButton pendingLabel={t("staffInvitation.admin.creating")}>{t("staffInvitation.admin.create")}</SubmitButton>
        </form>
      )}
      {link ? (
        <div className="mt-md flex flex-col gap-sm rounded-md border border-warning/40 bg-warning/10 p-md" role="status" data-testid="invitation-link">
          <p className="text-label font-semibold text-fg">{t("staffInvitation.admin.linkTitle")}</p>
          <p className="text-label text-fg-secondary">{t("staffInvitation.admin.linkWarning")}</p>
          <input readOnly dir="ltr" value={link} aria-label={t("staffInvitation.admin.linkTitle")} className="w-full rounded-sm border bg-surface px-sm py-xs text-label" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex items-center gap-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopiedToken(token);
                } catch {
                  setCopiedToken(null);
                }
              }}
            >
              {copied ? t("staffInvitation.admin.copied") : t("staffInvitation.admin.copy")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function RevokeForm({ id }: { id: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(revokeStaffInvitationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-xs">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`revoke-${id}`} className="sr-only">
        {t("staffInvitation.admin.revokeReason")}
      </label>
      <Input id={`revoke-${id}`} name="reason" type="text" maxLength={500} required placeholder={t("staffInvitation.admin.revokeReason")} />
      <SubmitButton variant="outline" size="sm">
        {t("staffInvitation.admin.revoke")}
      </SubmitButton>
      {state.code && !state.ok ? (
        <p role="alert" className="w-full text-label text-danger">
          {t(state.code)}
        </p>
      ) : null}
    </form>
  );
}
