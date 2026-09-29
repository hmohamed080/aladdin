import type { Locale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/translate";
import { formatAdminDateTime } from "@/lib/ui/format";
import type { PreviewFollowUp, PreviewFollowUpType } from "@/features/admin-preview/fixtures";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LabeledField, Select, Textarea } from "@/components/ui/controls";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";

type Messages = ReturnType<typeof getMessages>;

const TYPES: PreviewFollowUpType[] = ["call", "whatsapp", "email", "verificationFollowUp", "other"];

const dateInput =
  "min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40";

/**
 * Follow-up workflow (Phase 0D) — an operational contact attempt with an
 * outcome and an optional next-follow-up date/time and assignee.
 *
 * History: type · outcome · actor · logged · next follow-up · status. Status is
 * DERIVED: a follow-up that is not done and whose date has passed is Overdue;
 * it is never stored, so it cannot go stale. Log action opens a Preview dialog —
 * nothing is saved and no reminder is scheduled (no backend yet, by design).
 * Kept apart from Admin Notes, Audit and Activity (see `separationNote`).
 */
export function FollowUpPanel({
  m,
  locale,
  followUps,
  staffNames,
  now,
}: {
  m: Messages;
  locale: Locale;
  followUps: PreviewFollowUp[];
  /** Real Admin Staff names, for the "Assigned staff" choice. */
  staffNames: string[];
  now: number;
}) {
  const t = m.admin.preview.followUp;
  const typeLabels = m.admin.preview.users.followUpDialog.types as Record<PreviewFollowUpType, string>;

  const statusOf = (f: PreviewFollowUp): "open" | "done" | "overdue" => {
    if (f.done) return "done";
    if (f.followUpDate && new Date(f.followUpDate).getTime() < now) return "overdue";
    return "open";
  };
  const statusTone = { open: "accent", done: "success", overdue: "danger" } as const;

  const columns: Column<PreviewFollowUp>[] = [
    { key: "type", header: t.columns.type, minWidth: "10rem", nowrap: true, cell: (f) => <Badge tone="accent">{typeLabels[f.type]}</Badge> },
    { key: "outcome", header: t.columns.outcome, minWidth: "20rem", grow: true, cell: (f) => <span className="text-fg">{f.note}</span> },
    { key: "actor", header: t.columns.actor, minWidth: "9rem", nowrap: true, secondary: true, cell: (f) => f.actor },
    { key: "logged", header: t.columns.loggedAt, minWidth: "11rem", nowrap: true, secondary: true, cell: (f) => formatAdminDateTime(f.createdAt, locale) },
    {
      key: "next",
      header: t.columns.nextFollowUp,
      minWidth: "11rem",
      nowrap: true,
      cell: (f) => (f.followUpDate ? formatAdminDateTime(f.followUpDate, locale) : <span className="text-fg-muted">—</span>),
    },
    {
      key: "status",
      header: t.columns.status,
      minWidth: "7rem",
      nowrap: true,
      cell: (f) => {
        const s = statusOf(f);
        return <Badge tone={statusTone[s]}>{t.status[s]}</Badge>;
      },
    },
  ];

  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <h2 className="text-title text-fg">{t.historyTitle}</h2>
        <PreviewActionDialog
          wide
          trigger={t.logAction}
          triggerVariant="accent"
          title={t.dialogTitle}
          body={t.dialogBody}
          confirmLabel={t.save}
          confirmVariant="accent"
        >
          <LabeledField label={t.actionType} htmlFor="followup-type">
            <Select id="followup-type" defaultValue="call">
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {typeLabels[k]}
                </option>
              ))}
            </Select>
          </LabeledField>
          <LabeledField label={t.outcome} htmlFor="followup-outcome">
            <Textarea id="followup-outcome" rows={3} placeholder={t.outcomePlaceholder} required />
          </LabeledField>
          <div className="grid gap-md tablet:grid-cols-2">
            <LabeledField label={t.followUpDate} htmlFor="followup-date">
              <input id="followup-date" type="date" className={dateInput} />
            </LabeledField>
            <LabeledField label={t.followUpTime} htmlFor="followup-time">
              <input id="followup-time" type="time" className={dateInput} />
            </LabeledField>
          </div>
          <LabeledField label={t.assignedTo} htmlFor="followup-assignee">
            <Select id="followup-assignee" defaultValue="">
              <option value="">{t.unassigned}</option>
              {staffNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </LabeledField>
          <label className="flex items-start gap-2 text-body text-fg-secondary">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-accent-solid)]" />
            <span>
              {t.reminder}
              <span className="block text-label text-fg-muted">{t.reminderHint}</span>
            </span>
          </label>
        </PreviewActionDialog>
      </div>

      <p className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">
        {t.fixtureNotice} {t.separationNote}
      </p>

      <DataTable
        columns={columns}
        rows={followUps}
        rowKey={(f) => f.id}
        caption={t.historyTitle}
        minWidth="64rem"
        stackBelow="desktop"
        empty={<StatePanel title={t.historyEmpty} />}
      />
    </section>
  );
}
