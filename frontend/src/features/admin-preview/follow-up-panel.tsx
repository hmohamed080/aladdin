import type { Locale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/translate";
import { formatAdminDateTime } from "@/lib/ui/format";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LabeledField, Select, Textarea } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdminDateInput } from "@/features/admin-preview/admin-date-input";
import { AdminTimeInput } from "@/features/admin-preview/admin-time-input";
import { completeFollowUpAction, logFollowUpAction } from "@/server/actions/admin-operations";
import { FOLLOW_UP_TYPES, type AdminFollowUp, type FollowUpType, type PersonRef } from "@/features/admin-preview/operations-mappers";

type Messages = ReturnType<typeof getMessages>;

/** Approved dialog labels are keyed in camelCase; the database enum is snake_case. */
const TYPE_LABEL_KEY: Record<FollowUpType, "call" | "whatsapp" | "email" | "verificationFollowUp" | "other"> = {
  call: "call",
  whatsapp: "whatsapp",
  email: "email",
  verification_follow_up: "verificationFollowUp",
  other: "other",
};

/**
 * Follow-up workflow — Admin Core 1B-B, live. An operational contact attempt
 * with an outcome, an optional next-follow-up date/time and an assignee.
 *
 * History: type · outcome · actor · logged · next follow-up · status. Status is
 * DERIVED by the database (Done / Overdue / Open) — never stored, so it cannot
 * go stale. Logging and "Mark done" are real mutations (follow_ups.manage).
 * No reminder is delivered yet: the due time is stored and the option says so.
 * Kept apart from Admin Notes, Audit and the Entity Timeline (`separationNote`).
 * `followUps === null` = the caller cannot read follow-ups (locked state).
 */
export function FollowUpPanel({
  m,
  locale,
  subjectType,
  subjectId,
  followUps,
  assignees,
  canManage,
}: {
  m: Messages;
  locale: Locale;
  subjectType: "user" | "organization";
  subjectId: string;
  followUps: AdminFollowUp[] | null;
  /** Admin Staff who may be assigned (hold follow_ups.manage). */
  assignees: PersonRef[];
  canManage: boolean;
}) {
  const t = m.admin.preview.followUp;
  const ops = m.admin.preview.ops.followUp;
  const typeLabels = m.admin.preview.users.followUpDialog.types;
  const statusTone = { open: "accent", done: "success", overdue: "danger" } as const;
  const subjectFields = (
    <>
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
    </>
  );

  const columns: Column<AdminFollowUp>[] = [
    { key: "type", header: t.columns.type, minWidth: "10rem", nowrap: true, cell: (f) => <Badge tone="accent">{typeLabels[TYPE_LABEL_KEY[f.actionType]]}</Badge> },
    { key: "outcome", header: t.columns.outcome, minWidth: "20rem", grow: true, cell: (f) => <span className="whitespace-pre-line text-fg">{f.outcome}</span> },
    {
      key: "actor",
      header: t.columns.actor,
      minWidth: "9rem",
      nowrap: true,
      secondary: true,
      cell: (f) => (
        <span className="flex flex-col">
          <span>{f.loggedBy?.displayName || m.admin.users.unnamed}</span>
          {f.assignedTo ? (
            <span className="text-label text-fg-muted">
              {ops.assignedTo}: {f.assignedTo.displayName || m.admin.users.unnamed}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "logged", header: t.columns.loggedAt, minWidth: "11rem", nowrap: true, secondary: true, cell: (f) => formatAdminDateTime(f.loggedAt, locale) },
    {
      key: "next",
      header: t.columns.nextFollowUp,
      minWidth: "11rem",
      nowrap: true,
      cell: (f) => (f.dueAt ? formatAdminDateTime(f.dueAt, locale) : <span className="text-fg-muted">—</span>),
    },
    {
      key: "status",
      header: t.columns.status,
      minWidth: "12rem",
      nowrap: true,
      cell: (f) => (
        <span className="flex items-center gap-2">
          <Badge tone={statusTone[f.status]}>{t.status[f.status]}</Badge>
          {canManage && f.status !== "done" ? (
            <ConfirmDialog
              trigger={ops.markDone}
              triggerVariant="ghost"
              title={ops.markDoneTitle}
              confirmLabel={ops.markDone}
              confirmVariant="accent"
              formAction={completeFollowUpAction}
            >
              {subjectFields}
              <input type="hidden" name="followUpId" value={f.id} />
              <p className="text-body text-fg-secondary">{f.outcome}</p>
            </ConfirmDialog>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <h2 className="text-title text-fg">{t.historyTitle}</h2>
        {canManage ? (
          <ConfirmDialog
            wide
            trigger={t.logAction}
            triggerVariant="accent"
            title={t.dialogTitle}
            body={t.dialogBody}
            confirmLabel={t.save}
            confirmVariant="accent"
            formAction={logFollowUpAction}
          >
            {subjectFields}
            <LabeledField label={t.actionType} htmlFor="followup-type">
              <Select id="followup-type" name="actionType" defaultValue="call">
                {FOLLOW_UP_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {typeLabels[TYPE_LABEL_KEY[k]]}
                  </option>
                ))}
              </Select>
            </LabeledField>
            <LabeledField label={t.outcome} htmlFor="followup-outcome">
              <Textarea id="followup-outcome" name="outcome" rows={3} maxLength={2000} placeholder={t.outcomePlaceholder} required />
            </LabeledField>
            <div className="grid gap-md tablet:grid-cols-2">
              <LabeledField label={t.followUpDate} htmlFor="followup-date">
                <AdminDateInput id="followup-date" name="dueDate" label={t.followUpDate} />
              </LabeledField>
              <LabeledField label={t.followUpTime} htmlFor="followup-time">
                <AdminTimeInput id="followup-time" name="dueTime" label={t.followUpTime} />
              </LabeledField>
            </div>
            <LabeledField label={t.assignedTo} htmlFor="followup-assignee">
              <Select id="followup-assignee" name="assignedTo" defaultValue="">
                <option value="">{t.unassigned}</option>
                {assignees.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.displayName || m.admin.users.unnamed}
                  </option>
                ))}
              </Select>
            </LabeledField>
            {/* Reminder delivery does not exist yet — shown as not available, never as a live option. */}
            <label className="flex items-start gap-2 text-body text-fg-muted">
              <input type="checkbox" disabled className="mt-1 h-4 w-4" />
              <span>
                {t.reminder}
                <span className="block text-label">{ops.reminderNotDelivered}</span>
              </span>
            </label>
          </ConfirmDialog>
        ) : null}
      </div>

      <p className="text-label text-fg-muted">{t.separationNote}</p>

      {followUps === null ? (
        <StatePanel title={ops.locked} />
      ) : (
        <DataTable
          columns={columns}
          rows={followUps}
          rowKey={(f) => f.id}
          caption={t.historyTitle}
          minWidth="64rem"
          stackBelow="desktop"
          empty={<StatePanel title={t.historyEmpty} />}
        />
      )}
    </section>
  );
}
