import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listAudit } from "@/server/queries/admin-preview";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader } from "@/features/admin/parts";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { AuditResults } from "@/features/admin-preview/audit-results";

export const dynamic = "force-dynamic";

/**
 * Phase 0C — Audit Explorer. Real data: `listAudit()`, the same query the
 * live `/admin/audit` page uses, fetched at a larger limit (200) so the
 * preview filters have something real to narrow (BL-011 moves this to real
 * `.eq()`/`.gte()`/`.lte()` query params server-side — this Preview's
 * 200-row fetch is Preview UX, not the final architecture).
 *
 * Actor/action/entity filters apply automatically (`AutoFilters`, no Search
 * button) via a real Next.js soft-navigation. Pagination is handled entirely
 * by `AuditResults`, a client component holding its OWN page/page-size
 * state — Next/Previous/page-size never navigate, never refetch, and never
 * touch the Admin shell, the nav, or the filter controls above: only that
 * component's own subtree re-renders. This is the reference pattern every
 * future large Admin table should follow once built for real (Phase 2).
 */
export default async function PreviewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; subject?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { actor, action, subject } = await searchParams;
  const allEntries = await listAudit(supabase, 200);
  const actionLabels = m.admin.actions as Record<string, string>;

  const entries = allEntries.filter(
    (e) =>
      (!actor || e.actorName === actor) &&
      (!action || e.action === action) &&
      (!subject || e.subjectType === subject),
  );

  const actors = Array.from(new Set(allEntries.map((e) => e.actorName).filter((v): v is string => Boolean(v)))).sort();
  const actions = Array.from(new Set(allEntries.map((e) => e.action))).sort();
  const subjects = Array.from(new Set(allEntries.map((e) => e.subjectType))).sort();
  const at = m.admin.preview.audit;

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={at.title} subtitle={at.subtitle} count={entries.length} />
      <p className="-mt-2 text-label text-fg-muted">{m.admin.preview.users.previewTotalNote}</p>

      <AutoFilters
        fields={[
          { kind: "select", name: "actor", anyLabel: at.anyActor, options: actors.map((a) => ({ value: a, label: a })) },
          {
            kind: "select",
            name: "action",
            anyLabel: at.anyAction,
            options: actions.map((a) => ({ value: a, label: actionLabels[auditActionKey(a)] ?? a })),
          },
          { kind: "select", name: "subject", anyLabel: at.anySubject, options: subjects.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <AuditResults
        entries={entries}
        locale={locale}
        actionLabels={actionLabels}
        systemLabel={m.admin.audit.system}
        emptyTitle={at.empty}
        pageSizeLabel={m.admin.preview.users.pagination.pageSize}
        previousLabel={m.admin.preview.users.pagination.previous}
        nextLabel={m.admin.preview.users.pagination.next}
        showingTemplate={m.admin.preview.users.pagination.showing}
      />
    </div>
  );
}
