import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers } from "@/server/queries/admin";
import { previewUserPointsLedger } from "@/server/queries/admin-preview";
import { derivePointsLevel } from "@/lib/network/points-level";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDateTime, formatNumber } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel, Field, Badge } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { LabeledField, Textarea, Select } from "@/components/ui/controls";
import type { AdminUserRow } from "@/server/queries/admin";
import type { PointsLedgerEntry } from "@/server/queries/admin-preview";

export const dynamic = "force-dynamic";

type LedgerRow = PointsLedgerEntry & { balanceAfter: number };

/**
 * Phase 0C — complete rework of the Points Preview. Phase 0B's version was a
 * bare user picker; this page now shows the full operating model on ONE
 * page once a user is selected: balance, a REAL derived level/tier
 * (`derivePointsLevel()` — the same presentation-only band the Network
 * Points card already uses; never stored, never gates anything, per
 * `docs/database/points-core.md`), lifetime earned/spent, transaction
 * count, last activity, and the ledger itself with a running "balance
 * after" column derived from the real balance and the real deltas
 * (`points_ledger` is append-only — every field on every row is real).
 * Ledger filters apply automatically (`AutoFilters`) — no Search button.
 */
export default async function PreviewPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; user?: string; type?: string; source?: string; direction?: string; automanual?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q, user: userId, type, source, direction, automanual } = await searchParams;
  const pt = m.admin.preview.points;

  const users = await listUsers(supabase, q);
  const selectedUser = userId ? users.find((u) => u.id === userId) ?? (await listUsers(supabase)).find((u) => u.id === userId) : null;

  const columns: Column<AdminUserRow>[] = [
    {
      key: "name",
      header: m.admin.users.name,
      grow: true,
      cell: (u) => (
        <RecordCell
          title={u.displayName || m.admin.users.unnamed}
          href={`/admin/preview/points?user=${u.id}`}
          avatar={<Monogram name={u.displayName || "?"} size={28} />}
        />
      ),
    },
  ];

  let ledger: { entries: LedgerRow[]; balance: number } | null = null;
  if (selectedUser) {
    const raw = await previewUserPointsLedger(supabase, selectedUser.id);
    let running = raw.balance;
    const withBalance: LedgerRow[] = raw.entries.map((e) => {
      const row = { ...e, balanceAfter: running };
      running -= e.pointsDelta;
      return row;
    });
    ledger = { entries: withBalance, balance: raw.balance };
  }

  let filteredEntries: LedgerRow[] = ledger?.entries ?? [];
  if (type) filteredEntries = filteredEntries.filter((e) => e.eventType === type);
  if (source) filteredEntries = filteredEntries.filter((e) => e.sourceType === source);
  if (direction === "credit") filteredEntries = filteredEntries.filter((e) => e.pointsDelta >= 0);
  if (direction === "debit") filteredEntries = filteredEntries.filter((e) => e.pointsDelta < 0);
  if (automanual === "automatic") filteredEntries = filteredEntries.filter((e) => !e.awardedByUserId);
  if (automanual === "manual") filteredEntries = filteredEntries.filter((e) => e.awardedByUserId);

  let actorNames = new Map<string, string>();
  if (ledger && ledger.entries.length > 0) {
    const actorIds = Array.from(new Set(ledger.entries.flatMap((e) => (e.awardedByUserId ? [e.awardedByUserId] : []))));
    if (actorIds.length > 0) {
      const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
      actorNames = new Map((data ?? []).map((r) => [r.user_id, r.display_name]));
    }
  }

  const lifetimeEarned = (ledger?.entries ?? []).filter((e) => e.pointsDelta > 0).reduce((s, e) => s + e.pointsDelta, 0);
  const lifetimeSpent = (ledger?.entries ?? []).filter((e) => e.pointsDelta < 0).reduce((s, e) => s + Math.abs(e.pointsDelta), 0);
  const levelInfo = ledger ? derivePointsLevel(ledger.balance) : null;
  const eventTypes = Array.from(new Set((ledger?.entries ?? []).map((e) => e.eventType)));
  const sourceTypes = Array.from(new Set((ledger?.entries ?? []).map((e) => e.sourceType)));

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={pt.title} subtitle={pt.subtitle} />

      <Card className="flex flex-col gap-sm">
        <p className="text-label font-medium text-fg-secondary">{pt.pickUser}</p>
        <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />
        {users.length === 0 ? (
          <StatePanel title={m.admin.preview.users.empty} />
        ) : (
          <DataTable columns={columns} rows={users.slice(0, 8)} rowKey={(u) => u.id} caption={pt.title} empty={<StatePanel title={m.admin.preview.users.empty} />} />
        )}
      </Card>

      {selectedUser && ledger && levelInfo ? (
        <div className="flex flex-col gap-lg">
          <Card>
            <SectionTitle>{selectedUser.displayName || m.admin.users.unnamed}</SectionTitle>
            <dl className="mt-md grid gap-md tablet:grid-cols-3 desktop:grid-cols-6">
              <Field label={pt.balance}>{formatNumber(ledger.balance, locale)}</Field>
              <Field label={pt.levelLabel}>
                <Badge tone="accent">{pt.levelValue.replace("{level}", String(levelInfo.level))}</Badge>
              </Field>
              <Field label={pt.lifetimeEarned}>{formatNumber(lifetimeEarned, locale)}</Field>
              <Field label={pt.lifetimeSpent}>{formatNumber(lifetimeSpent, locale)}</Field>
              <Field label={pt.transactionCount}>{formatNumber(ledger.entries.length, locale)}</Field>
              <Field label={pt.lastActivity}>{ledger.entries[0] ? formatDateTime(ledger.entries[0].createdAt, locale) : "—"}</Field>
            </dl>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-md">
            <SectionTitle>{pt.ledgerTitle}</SectionTitle>
            <PreviewActionDialog trigger={pt.adjust} title={pt.adjustTitle} body={pt.adjustBody} confirmLabel={pt.adjust} confirmVariant="accent">
              <LabeledField label={pt.direction} htmlFor="adjust-direction">
                <Select id="adjust-direction" defaultValue="credit">
                  <option value="credit">{pt.creditLabel}</option>
                  <option value="debit">{pt.debitLabel}</option>
                </Select>
              </LabeledField>
              <LabeledField label={pt.amountLabel} htmlFor="adjust-amount">
                <input id="adjust-amount" type="number" min={0} className="min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body-lg text-fg" placeholder="100" />
              </LabeledField>
              <LabeledField label={pt.reasonLabel} htmlFor="adjust-reason">
                <Textarea id="adjust-reason" rows={2} required />
              </LabeledField>
              <LabeledField label={pt.referenceLabel} htmlFor="adjust-reference">
                <input id="adjust-reference" className="min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body text-fg" />
              </LabeledField>
            </PreviewActionDialog>
          </div>

          <AutoFilters
            fields={[
              { kind: "select", name: "type", anyLabel: pt.anyType, options: eventTypes.map((v) => ({ value: v, label: v })) },
              { kind: "select", name: "source", anyLabel: pt.anySource, options: sourceTypes.map((v) => ({ value: v, label: v })) },
              {
                kind: "select",
                name: "direction",
                anyLabel: pt.anyDirection,
                options: [
                  { value: "credit", label: pt.creditLabel },
                  { value: "debit", label: pt.debitLabel },
                ],
              },
              {
                kind: "select",
                name: "automanual",
                anyLabel: pt.anyAutomanual,
                options: [
                  { value: "automatic", label: pt.automatic },
                  { value: "manual", label: pt.manual },
                ],
              },
            ]}
          />

          {filteredEntries.length === 0 ? (
            <StatePanel title={pt.ledgerEmpty} />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[64rem] border-collapse text-body">
                <thead>
                  <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
                    <th className="px-md py-2 text-start font-medium">{pt.columns.date}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.event}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.direction}</th>
                    <th className="px-md py-2 text-end font-medium">{pt.columns.amount}</th>
                    <th className="px-md py-2 text-end font-medium">{pt.balanceEffect}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.source}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.referenceLabel}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.reason}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.actor}</th>
                    <th className="px-md py-2 text-end font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="px-md py-2.5 text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</td>
                      <td className="px-md py-2.5">{e.eventType}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.pointsDelta >= 0 ? pt.creditLabel : pt.debitLabel}</td>
                      <td className={`px-md py-2.5 text-end tabular-nums ${e.pointsDelta >= 0 ? "text-success" : "text-danger"}`}>
                        {e.pointsDelta >= 0 ? "+" : ""}
                        {formatNumber(e.pointsDelta, locale)}
                      </td>
                      <td className="px-md py-2.5 text-end tabular-nums text-fg-secondary">{formatNumber(e.balanceAfter, locale)}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.sourceType}</td>
                      <td className="px-md py-2.5 text-label text-fg-muted">{e.sourceId.slice(0, 8)}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.reasonCode ?? "—"}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.awardedByUserId ? (actorNames.get(e.awardedByUserId) ?? pt.manual) : pt.automatic}</td>
                      <td className="px-md py-2.5 text-end">
                        {!e.reversesEntryId ? (
                          <PreviewActionDialog trigger={pt.reverse} triggerVariant="ghost" title={pt.reverseTitle} body={pt.reverseBody} confirmLabel={pt.reverse} confirmVariant="danger">
                            <p className="text-label text-fg-muted">
                              {pt.originalTransaction}: {e.eventType} ({e.pointsDelta >= 0 ? "+" : ""}
                              {formatNumber(e.pointsDelta, locale)})
                            </p>
                            <p className="text-label text-fg-secondary">{pt.confirmReversal}</p>
                          </PreviewActionDialog>
                        ) : (
                          <StatusBadge status="reversed" label={pt.reversed} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : userId ? (
        <StatePanel title={m.admin.preview.users.empty} />
      ) : null}
    </div>
  );
}
