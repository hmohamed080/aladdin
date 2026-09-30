import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listUsers } from "@/server/queries/admin";
import { previewUserPointsLedger, previewLatestPointsUserId } from "@/server/queries/admin-preview";
import { PREVIEW_POINTS_FIXTURE } from "@/features/admin-preview/fixtures";
import { derivePointsLevel } from "@/lib/network/points-level";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDateTime, formatNumber } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, SectionTitle, StatePanel, Field, Badge } from "@/components/ui/primitives";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { AutoFilters } from "@/features/admin-preview/auto-filters";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { TablePagination } from "@/features/admin-preview/table-pagination";
import { clampPageSize, paginate } from "@/features/admin-preview/table-state";
import { LabeledField, Textarea, Select } from "@/components/ui/controls";
import type { AdminUserRow } from "@/server/queries/admin";
import type { PointsLedgerEntry } from "@/server/queries/admin-preview";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

type LedgerRow = PointsLedgerEntry & {
  balanceAfter: number;
  actorName: string | null;
  /** True when a later compensating entry already reverses this one. */
  alreadyReversed: boolean;
};

const inputClass =
  "min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40";

/**
 * Points — Phase 0D. The page opens on a DEFAULT user immediately (summary +
 * ledger with a running balance), with Adjust and Reverse dialogs. No mutation.
 *
 * Data honesty (Product Owner decision C):
 *  - If the environment has genuine ledger data, the default user is the one
 *    whose ledger changed most recently — real balance, real ledger.
 *  - If it has none, a clearly-labelled isolated Preview FIXTURE account is
 *    shown instead, with a permanent notice. Fixture balances/transactions are
 *    never presented as real.
 *  - No referral/points record is EVER created in the shared local database to
 *    make this page look populated (that DB already carries leftover state that
 *    breaks order-dependent pgTAP). A true Points E2E belongs to an isolated,
 *    clean DB during backend acceptance.
 *  - Adjust / Reverse are `PreviewActionDialog`s: they never call an RPC.
 *
 * The level shown is the presentation-only band from `derivePointsLevel()`
 * (never stored, never gates anything — `docs/database/points-core.md`).
 */
export default async function PreviewPointsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    user?: string;
    type?: string;
    source?: string;
    direction?: string;
    automanual?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  await requireAdminRoute("/admin/preview/points");
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q, user: userParam, type, source, direction, automanual, page: pageParam, pageSize: pageSizeParam } = await searchParams;
  const pt = m.admin.preview.points;

  const users = await listUsers(supabase, q);

  // Explicit choice wins; otherwise the most recently active REAL ledger; else fixture.
  const latestUserId = userParam ? null : await previewLatestPointsUserId(supabase);
  const selectedId = userParam ?? latestUserId;
  const selectedUser: AdminUserRow | null = selectedId
    ? (users.find((u) => u.id === selectedId) ?? (await listUsers(supabase)).find((u) => u.id === selectedId) ?? null)
    : null;
  // Fixture ONLY when the environment has no ledger row anywhere (and nobody was chosen).
  const usingFixture = !userParam && !selectedId;

  let ledger: { entries: LedgerRow[]; balance: number } | null = null;
  if (selectedId) {
    const raw = await previewUserPointsLedger(supabase, selectedId);
    const actorIds = Array.from(new Set(raw.entries.flatMap((e) => (e.awardedByUserId ? [e.awardedByUserId] : []))));
    let actorNames = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
      actorNames = new Map((data ?? []).map((r) => [r.user_id, r.display_name]));
    }
    ledger = { entries: withRunningBalance(raw.entries, raw.balance, (e) => (e.awardedByUserId ? (actorNames.get(e.awardedByUserId) ?? null) : null)), balance: raw.balance };
  } else if (usingFixture) {
    const balance = PREVIEW_POINTS_FIXTURE.reduce((sum, e) => sum + e.pointsDelta, 0);
    const byId = new Map(PREVIEW_POINTS_FIXTURE.map((e) => [e.id, e.actorName]));
    ledger = { entries: withRunningBalance(PREVIEW_POINTS_FIXTURE, balance, (e) => byId.get(e.id) ?? null), balance };
  }

  let filtered: LedgerRow[] = ledger?.entries ?? [];
  if (type) filtered = filtered.filter((e) => e.eventType === type);
  if (source) filtered = filtered.filter((e) => e.sourceType === source);
  if (direction === "credit") filtered = filtered.filter((e) => e.pointsDelta >= 0);
  if (direction === "debit") filtered = filtered.filter((e) => e.pointsDelta < 0);
  if (automanual === "automatic") filtered = filtered.filter((e) => !e.awardedByUserId);
  if (automanual === "manual") filtered = filtered.filter((e) => e.awardedByUserId);

  const pageSize = clampPageSize(pageSizeParam);
  const slice = paginate(filtered, pageParam, pageSize);

  const entries = ledger?.entries ?? [];
  const lifetimeEarned = entries.filter((e) => e.pointsDelta > 0).reduce((s, e) => s + e.pointsDelta, 0);
  const lifetimeSpent = entries.filter((e) => e.pointsDelta < 0).reduce((s, e) => s + Math.abs(e.pointsDelta), 0);
  const levelInfo = ledger ? derivePointsLevel(ledger.balance) : null;
  const eventTypes = Array.from(new Set(entries.map((e) => e.eventType)));
  const sourceTypes = Array.from(new Set(entries.map((e) => e.sourceType)));
  const displayName = usingFixture ? pt.fixtureUserName : (selectedUser?.displayName || m.admin.users.unnamed);
  const lc = pt.ledgerColumns;

  const pickerColumns: Column<AdminUserRow>[] = [
    {
      key: "name",
      header: m.admin.users.name,
      grow: true,
      cell: (u) => (
        <RecordCell
          wrap
          title={u.displayName || m.admin.users.unnamed}
          href={`/admin/preview/points?user=${u.id}`}
          avatar={<Monogram name={u.displayName || "?"} size={28} />}
        />
      ),
    },
  ];

  const ledgerColumns: Column<LedgerRow>[] = [
    { key: "date", header: lc.date, minWidth: "10.5rem", nowrap: true, cell: (e) => <span className="text-label">{formatAdminDateTime(e.createdAt, locale)}</span> },
    {
      key: "amount",
      header: lc.amount,
      minWidth: "6rem",
      nowrap: true,
      numeric: true,
      cell: (e) => (
        <span className={e.pointsDelta >= 0 ? "text-success" : "text-danger"}>
          {e.pointsDelta >= 0 ? "+" : ""}
          {formatNumber(e.pointsDelta, locale)}
        </span>
      ),
    },
    { key: "dir", header: lc.creditDebit, minWidth: "7rem", nowrap: true, cell: (e) => (e.pointsDelta >= 0 ? pt.credit : pt.debit) },
    { key: "source", header: lc.source, minWidth: "10rem", cell: (e) => <span className="break-words">{e.sourceType}</span> },
    { key: "reference", header: lc.reference, minWidth: "8rem", nowrap: true, secondary: true, cell: (e) => <code dir="ltr" className="text-label text-fg-muted">{e.sourceId.slice(0, 8)}</code> },
    { key: "reason", header: lc.reason, minWidth: "12rem", secondary: true, cell: (e) => <span className="break-words">{e.reasonCode ?? e.eventType}</span> },
    { key: "auto", header: lc.automanual, minWidth: "8rem", nowrap: true, cell: (e) => (e.awardedByUserId ? pt.manual : pt.automatic) },
    { key: "actor", header: lc.actor, minWidth: "10rem", secondary: true, cell: (e) => e.actorName ?? <span className="text-fg-muted">—</span> },
    { key: "balance", header: lc.balance, minWidth: "8rem", nowrap: true, numeric: true, cell: (e) => formatNumber(e.balanceAfter, locale) },
    {
      key: "actions",
      header: lc.actions,
      minWidth: "9rem",
      nowrap: true,
      cell: (e) =>
        e.reversesEntryId ? (
          <StatusBadge status="reversed" label={pt.reversed} />
        ) : e.alreadyReversed ? (
          <StatusBadge status="reversed" label={pt.reversed} />
        ) : (
          <PreviewActionDialog trigger={pt.reverse} triggerVariant="ghost" title={pt.reverseTitle} body={pt.reverseBody} confirmLabel={pt.reverse} confirmVariant="danger">
            <p className="text-label text-fg-muted">
              {pt.originalTransaction}: {e.eventType} ({e.pointsDelta >= 0 ? "+" : ""}
              {formatNumber(e.pointsDelta, locale)})
            </p>
            <LabeledField label={pt.reverseReasonLabel} htmlFor={`reverse-reason-${e.id}`}>
              <Textarea id={`reverse-reason-${e.id}`} rows={2} required />
            </LabeledField>
            <label className="flex items-start gap-2 text-label text-fg-secondary">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-accent-solid)]" />
              <span>{pt.reverseConfirmLabel}</span>
            </label>
          </PreviewActionDialog>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={pt.title} subtitle={pt.subtitle} />

      {ledger && levelInfo ? (
        <div className="flex flex-col gap-lg">
          <p
            role="note"
            className={
              usingFixture
                ? "rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary"
                : "text-label text-fg-muted"
            }
          >
            {usingFixture ? pt.fixtureLedgerNotice : userParam ? pt.realDataNote : `${pt.defaultUserNote} ${pt.realDataNote}`}
          </p>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>{displayName}</SectionTitle>
              {usingFixture ? <Badge tone="warning">{m.admin.preview.previewOnlyBadge}</Badge> : null}
            </div>
            <dl className="mt-md grid gap-md tablet:grid-cols-3 desktop:grid-cols-6">
              <Field label={pt.balance}>{formatNumber(ledger.balance, locale)}</Field>
              <Field label={pt.levelLabel}>
                <Badge tone="accent">{pt.levelValue.replace("{level}", formatNumber(levelInfo.level, locale))}</Badge>
              </Field>
              <Field label={pt.lifetimeEarned}>{formatNumber(lifetimeEarned, locale)}</Field>
              <Field label={pt.lifetimeSpent}>{formatNumber(lifetimeSpent, locale)}</Field>
              <Field label={pt.transactionCount}>{formatNumber(entries.length, locale)}</Field>
              <Field label={pt.lastActivity}>{entries[0] ? formatAdminDateTime(entries[0].createdAt, locale) : "—"}</Field>
            </dl>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-md">
            <SectionTitle>{pt.ledgerTitle}</SectionTitle>
            <PreviewActionDialog trigger={pt.adjust} triggerVariant="accent" title={pt.adjustTitle} body={pt.adjustBody} confirmLabel={pt.adjust} confirmVariant="accent">
              <LabeledField label={pt.direction} htmlFor="adjust-direction">
                <Select id="adjust-direction" defaultValue="credit">
                  <option value="credit">{pt.creditLabel}</option>
                  <option value="debit">{pt.debitLabel}</option>
                </Select>
              </LabeledField>
              <LabeledField label={pt.amountLabel} htmlFor="adjust-amount">
                <input id="adjust-amount" type="number" min={0} className={inputClass} placeholder="100" />
              </LabeledField>
              <LabeledField label={pt.reasonLabel} htmlFor="adjust-reason">
                <Textarea id="adjust-reason" rows={2} required />
              </LabeledField>
              <LabeledField label={pt.referenceLabel} htmlFor="adjust-reference">
                <input id="adjust-reference" className={inputClass} />
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

          <DataTable
            columns={ledgerColumns}
            rows={slice.rows}
            rowKey={(e) => e.id}
            caption={pt.ledgerTitle}
            minWidth="78rem"
            stackBelow="desktop"
            empty={<StatePanel title={pt.ledgerEmpty} />}
          />
          {filtered.length > 0 ? <TablePagination {...slice} pageSize={pageSize} /> : null}
        </div>
      ) : (
        <StatePanel title={userParam ? m.admin.preview.users.empty : pt.noLedgerAnywhere} />
      )}

      <details className="rounded-md border bg-surface" open={Boolean(q)}>
        <summary className="cursor-pointer px-md py-3 text-label font-medium text-fg-secondary">{pt.changeUser}</summary>
        <div className="flex flex-col gap-sm border-t p-md">
          <p className="text-label font-medium text-fg-secondary">{pt.pickUser}</p>
          <AutoFilters fields={[{ kind: "text", name: "q", placeholder: m.admin.preview.users.searchPlaceholder }]} />
          {users.length === 0 ? (
            <StatePanel title={m.admin.preview.users.empty} />
          ) : (
            <DataTable columns={pickerColumns} rows={users.slice(0, 8)} rowKey={(u) => u.id} caption={pt.title} empty={<StatePanel title={m.admin.preview.users.empty} />} />
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Walks a newest-first ledger backwards from the current balance to derive each
 * row's running "balance after", and marks originals a later compensating entry
 * already reverses. Pure presentation over the real (or fixture) deltas.
 */
function withRunningBalance<E extends PointsLedgerEntry>(
  entries: readonly E[],
  balance: number,
  actorName: (e: E) => string | null,
): LedgerRow[] {
  const reversed = new Set(entries.flatMap((e) => (e.reversesEntryId ? [e.reversesEntryId] : [])));
  let running = balance;
  return entries.map((e) => {
    const row: LedgerRow = { ...e, balanceAfter: running, actorName: actorName(e), alreadyReversed: reversed.has(e.id) };
    running -= e.pointsDelta;
    return row;
  });
}
