import { getMessages } from "@/lib/i18n/translate";
import { formatDateTime } from "@/lib/ui/format";
import type { Locale } from "@/lib/i18n/locales";
import type { AuditEntry } from "@/server/queries/admin";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { StatePanel } from "@/components/ui/primitives";
import { ScrollIcon } from "@/components/ui/icons";

/**
 * Readable recent audit events: actor · action · target · time. Every action the
 * platform can emit has a label (pinned by `audit-actions.test.ts`); the raw key
 * is only ever a fallback for an action added to the database without one. The
 * target shows the resolved user/organization name when there is one, and falls
 * back to the subject discriminator otherwise.
 */
export function AuditFeed({ entries, locale }: { entries: AuditEntry[]; locale: Locale }) {
  const m = getMessages(locale);
  const actions = m.admin.actions as Record<string, string>;
  if (entries.length === 0) {
    return <StatePanel title={m.admin.audit.empty} icon={<ScrollIcon size={22} />} />;
  }
  return (
    <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2.5 odd:bg-surface-2/30">
          <span className="font-medium text-fg">{e.actorName ?? m.admin.audit.system}</span>
          {e.actorRole ? (
            <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-label text-fg-muted">{e.actorRole}</span>
          ) : null}
          <span className="text-fg-secondary">{actions[auditActionKey(e.action)] ?? e.action}</span>
          <span className="min-w-0 truncate text-label text-fg-muted">
            · {e.subjectName ?? e.subjectType}
          </span>
          <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</span>
        </li>
      ))}
    </ol>
  );
}
