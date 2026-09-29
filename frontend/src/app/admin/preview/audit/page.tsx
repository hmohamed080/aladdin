import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { previewAuditDetailed } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDateTime } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader } from "@/features/admin/parts";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { AuditResults, type AuditRow } from "@/features/admin-preview/audit-results";
import { describeAuditMetadata, summarizeAuditDetails } from "@/features/admin-preview/audit-details";

export const dynamic = "force-dynamic";

/**
 * Audit Explorer — Phase 0D presentation. Real data: the same `audit_log` the
 * live `/admin/audit` reads (plus `metadata` / `organization_id` for the
 * expandable row), fetched at a larger limit (200) so the filters have
 * something real to narrow. That 200-row fetch is Preview UX, not the final
 * architecture — BL-011 moves these filters into the query itself.
 *
 * Filters (all auto-applied, no Search button): Actor · Action · Entity type ·
 * From / To date · free text. Columns: Actor · Action · Entity · Details ·
 * Context · Date & time (`DD/MM/YYYY HH:mm:ss`). "Context" is the organization
 * an event belongs to; the audit log records no page/route, so none is shown or
 * invented. Pagination is local to `AuditResults` (the Phase 0C partial-
 * pagination pattern) with the shared footer.
 *
 * Admin Audit records admin/system ACTIONS. Analytics records product USAGE.
 * The two are never mixed.
 */
export default async function PreviewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; subject?: string; from?: string; to?: string; q?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { actor, action, subject, from, to, q } = await searchParams;
  const all = await previewAuditDetailed(supabase, 200);
  const actionLabels = m.admin.actions as Record<string, string>;
  const at = m.admin.preview.audit;
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  const rows: AuditRow[] = all.map((e) => {
    const details = describeAuditMetadata(e.metadata);
    return {
      id: e.id,
      actor: e.actorName ?? m.admin.audit.system,
      role: e.actorRole,
      action: actionLabels[auditActionKey(e.action)] ?? e.action,
      entity: e.subjectType,
      summary: summarizeAuditDetails(details),
      context: e.organizationName,
      dateTime: formatAdminDateTime(e.createdAt, locale),
      detail: {
        target: e.subjectName ?? e.subjectId ?? e.subjectType,
        reference: details.referenceId ?? e.subjectId,
        reason: details.reason,
        before: details.before,
        after: details.after,
        organization: e.organizationName,
        rest: details.rest,
      },
    };
  });

  const needle = (q ?? "").trim().toLowerCase();
  const entries = all
    .map((e, i) => ({ e, row: rows[i]! }))
    .filter(({ e, row }) => {
      const day = e.createdAt.slice(0, 10);
      return (
        (!actor || e.actorName === actor) &&
        (!action || e.action === action) &&
        (!subject || e.subjectType === subject) &&
        (!from || !ISO_DAY.test(from) || day >= from) &&
        (!to || !ISO_DAY.test(to) || day <= to) &&
        (!needle ||
          `${row.actor} ${row.action} ${row.entity} ${row.summary ?? ""} ${row.context ?? ""} ${row.detail.target}`.toLowerCase().includes(needle))
      );
    })
    .map(({ row }) => row);

  const actors = Array.from(new Set(all.map((e) => e.actorName).filter((v): v is string => Boolean(v)))).sort();
  const actions = Array.from(new Set(all.map((e) => e.action))).sort();
  const subjects = Array.from(new Set(all.map((e) => e.subjectType))).sort();

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={at.title} subtitle={at.subtitle} count={entries.length} />
      <p className="-mt-2 text-label text-fg-muted">{m.admin.preview.users.previewTotalNote}</p>

      <AutoFilters
        fields={[
          { kind: "text", name: "q", placeholder: at.textSearch },
          { kind: "select", name: "actor", anyLabel: at.anyActor, options: actors.map((a) => ({ value: a, label: a })) },
          {
            kind: "select",
            name: "action",
            anyLabel: at.anyAction,
            options: actions.map((a) => ({ value: a, label: actionLabels[auditActionKey(a)] ?? a })),
          },
          { kind: "select", name: "subject", anyLabel: at.anySubject, options: subjects.map((s) => ({ value: s, label: s })) },
          { kind: "date", name: "from", label: at.fromDate },
          { kind: "date", name: "to", label: at.toDate },
        ]}
      />

      <AuditResults rows={entries} />
    </div>
  );
}
