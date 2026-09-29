import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUserDetail } from "@/server/queries/admin";
import { previewUserPointsLedger, previewUserTimeline, previewSubjectAudit } from "@/server/queries/admin-preview";
import { previewNotesFor, previewCompletenessFor, previewUserDuplicateFlag, previewFollowUpsFor } from "@/features/admin-preview/fixtures";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatDateTime, formatNumber } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { TabLinks } from "@/components/ui/stat-tiles";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { LabeledField, Textarea, Select, Input, ButtonLink } from "@/components/ui/controls";

export const dynamic = "force-dynamic";

/**
 * Phase 0 preview — User Details (BL-021's locked information architecture):
 * Overview / Profile / Organizations / Verification / Points / Activity /
 * Admin Notes / Audit. Real data everywhere it exists (getUserDetail, the
 * Points ledger, the composed Entity Timeline, the scoped audit read); the
 * "Admin Notes" tab is the one section with no backend (BL-008) and uses a
 * clearly-labelled preview fixture. Suspend/Restore are shown as preview-only
 * dialogs (BL-001) — no real mutation is possible from this page.
 *
 * Only the ACTIVE tab's own data is fetched, server-side, before render —
 * there is no client-side tab component here, each tab is its own request.
 */
export default async function PreviewUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam || "overview";
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const user = await getUserDetail(supabase, id);
  if (!user) notFound();

  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const actionLabels = m.admin.actions as Record<string, string>;
  const t = m.admin.preview.users;
  const pt = m.admin.preview.points;
  const tl = m.admin.preview.timeline;
  const nt = m.admin.preview.notes;
  const ov = m.admin.preview.userOverview;
  const headerMoreActions: RowAction[] = [
    { kind: "link", label: t.rowActions.viewProfile, href: `/p/${id}` },
    { kind: "link", label: t.rowActions.addNote, href: `/admin/preview/users/${id}?tab=notes` },
    { kind: "link", label: t.rowActions.followUp, href: `/admin/preview/users/${id}?tab=followup` },
    { kind: "link", label: t.rowActions.report, href: `/admin/preview/users/${id}?tab=report` },
    { kind: "link", label: t.rowActions.audit, href: `/admin/preview/users/${id}?tab=audit` },
    ...(user.memberships[0]
      ? [{ kind: "link" as const, label: t.rowActions.viewOrg, href: `/admin/preview/organizations/${user.memberships[0].orgId}` }]
      : []),
  ];

  const points = tab === "points" || tab === "overview" ? await previewUserPointsLedger(supabase, id) : null;
  let pointsActorNames = new Map<string, string>();
  if (points && points.entries.length > 0) {
    const actorIds = Array.from(new Set(points.entries.flatMap((e) => (e.awardedByUserId ? [e.awardedByUserId] : []))));
    if (actorIds.length > 0) {
      const { data: actorProfiles } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
      pointsActorNames = new Map((actorProfiles ?? []).map((r) => [r.user_id, r.display_name]));
    }
  }
  const timeline = tab === "activity" ? await previewUserTimeline(supabase, id) : null;
  const auditEntries = tab === "audit" ? await previewSubjectAudit(supabase, "user", id) : null;
  const notes = tab === "notes" ? previewNotesFor(id) : null;
  const followUps = tab === "followup" ? previewFollowUpsFor(id) : null;
  const fu = t.followUpDialog;
  const rp = t.reportDialog;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/preview/users" className="text-label text-accent hover:underline">
        ← {t.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <AdminHeader locale={locale} title={user.displayName || m.admin.users.unnamed} subtitle={user.headline ?? undefined} />
          <div className="flex items-center gap-2">
            <StatusBadge status={user.status} label={statusLabels[user.status] ?? user.status} />
            {user.isVerified ? <Badge tone="success">{m.admin.users.verified}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-sm">
          {user.status === "pending_verification" ? (
            <>
              <PreviewActionDialog trigger={ov.verify} triggerVariant="accent" title={ov.verify} confirmLabel={ov.verify} confirmVariant="accent" />
              <PreviewActionDialog trigger={ov.reject} triggerVariant="danger" title={m.admin.preview.review.rejectTitle} body={m.admin.preview.review.rejectBody} confirmLabel={ov.reject} confirmVariant="danger" />
            </>
          ) : null}
          {user.status === "suspended" ? (
            <PreviewActionDialog trigger={t.restore} triggerVariant="outline" title={t.restoreTitle} body={t.restoreBody} confirmLabel={t.restore} confirmVariant="accent" />
          ) : (
            <PreviewActionDialog trigger={t.suspend} triggerVariant="danger" title={t.suspendTitle} body={t.suspendBody} confirmLabel={t.suspend} confirmVariant="danger">
              <LabeledField label={t.reasonLabel} htmlFor="suspend-reason">
                <Textarea id="suspend-reason" rows={3} placeholder={t.reasonPlaceholder} required />
              </LabeledField>
            </PreviewActionDialog>
          )}
          <RowActionsMenu label={t.moreActions} actions={headerMoreActions} />
        </div>
      </div>

      <TabLinks
        basePath={`/admin/preview/users/${id}`}
        param="tab"
        current={tab === "overview" ? "" : tab}
        label={t.title}
        locale={locale}
        tabs={[
          { value: "", label: t.tabs.overview },
          { value: "profile", label: t.tabs.profile },
          { value: "organizations", label: t.tabs.organizations },
          { value: "verification", label: t.tabs.verification },
          { value: "points", label: t.tabs.points },
          { value: "activity", label: t.tabs.activity },
          { value: "followup", label: fu.historyTitle },
          { value: "notes", label: t.tabs.notes },
          { value: "audit", label: t.tabs.audit },
        ]}
      />

      {tab === "overview" ? (
        <div className="flex flex-wrap gap-sm">
          <ButtonLink variant="ghost" size="sm" href={`/p/${id}`}>
            {t.rowActions.viewProfile}
          </ButtonLink>
          <span className="self-center text-label text-fg-muted">{t.viewAsProfileNote}</span>
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="flex flex-col gap-lg">
          <Card>
            <dl className="grid gap-md tablet:grid-cols-3">
              <Field label={m.admin.users.type}>
                {user.accountType ? (typeLabels[user.accountType] ?? user.accountType) : m.admin.users.businessOnly}
              </Field>
              <Field label={m.admin.users.status}>{statusLabels[user.status] ?? user.status}</Field>
              <Field label={m.admin.users.joined}>{formatAdminDate(user.createdAt, locale)}</Field>
              <Field label={ov.organizationsSummary}>{formatNumber(user.memberships.length, locale)}</Field>
              <Field label={ov.pointsSummary}>{points ? formatNumber(points.balance, locale) : "—"}</Field>
            </dl>
          </Card>

          <Card className="flex flex-col gap-sm">
            <SectionTitle>{ov.recentFlags}</SectionTitle>
            {(() => {
              const flags: string[] = [];
              if (user.status === "suspended") flags.push(t.suspendTitle);
              if (user.verifications.some((v) => v.status === "rejected")) flags.push(m.admin.preview.review.rejectTitle);
              if (previewUserDuplicateFlag(user.id)) flags.push(m.admin.preview.duplicateBadge);
              if (previewCompletenessFor(user.id) < 70) flags.push(m.admin.preview.dashboard.attentionSections.incompleteProfiles);
              return flags.length === 0 ? (
                <p className="text-body text-fg-secondary">{ov.noFlags}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {flags.map((f) => (
                    <Badge key={f} tone="warning">
                      {f}
                    </Badge>
                  ))}
                </div>
              );
            })()}
          </Card>
        </div>
      ) : null}

      {tab === "profile" ? (
        <Card>
          <dl className="grid gap-md tablet:grid-cols-2">
            <Field label={m.admin.users.name}>{user.displayName || m.admin.users.unnamed}</Field>
            <Field label={m.admin.users.type}>{user.headline ?? "—"}</Field>
          </dl>
        </Card>
      ) : null}

      {tab === "organizations" ? (
        <section className="flex flex-col gap-md">
          {user.memberships.length === 0 ? (
            <StatePanel title={m.admin.users.noMemberships} />
          ) : (
            <div className="flex flex-col gap-sm">
              {user.memberships.map((mm) => (
                <Card key={mm.membershipId} pad="sm" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-md">
                    <Link href={`/admin/preview/organizations/${mm.orgId}`} className="font-medium text-accent hover:underline">
                      {mm.orgName}
                    </Link>
                    <StatusBadge status={mm.status} label={statusLabels[mm.status] ?? mm.status} />
                  </div>
                  {mm.capabilities.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {mm.capabilities.map((c) => (
                        <span key={c} className="rounded-pill bg-surface-2 px-2 py-0.5 text-label text-fg-secondary">
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "verification" ? (
        <section className="flex flex-col gap-md">
          {user.verifications.length === 0 ? (
            <StatePanel title={m.admin.users.noVerifications} />
          ) : (
            <div className="flex flex-col gap-sm">
              {user.verifications.map((v) => (
                <Card key={v.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                  <div>
                    <p className="text-body font-medium text-fg">
                      {(m.admin.verificationType as Record<string, string>)[v.verificationType] ?? v.verificationType}
                      {v.requestedAccountType ? ` → ${typeLabels[v.requestedAccountType] ?? v.requestedAccountType}` : ""}
                    </p>
                    <p className="text-label text-fg-muted">{formatAdminDate(v.submittedAt, locale)}</p>
                  </div>
                  <StatusBadge status={v.status} label={statusLabels[v.status] ?? v.status} />
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "points" && points ? (
        <section className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-md">
            <SectionTitle>
              {pt.summary}: {formatNumber(points.balance, locale)}
            </SectionTitle>
            <PreviewActionDialog trigger={pt.adjust} title={pt.adjustTitle} body={pt.adjustBody} confirmLabel={pt.adjust} confirmVariant="accent">
              <LabeledField label={pt.direction} htmlFor="adjust-direction">
                <Select id="adjust-direction" defaultValue="credit">
                  <option value="credit">{pt.creditLabel}</option>
                  <option value="debit">{pt.debitLabel}</option>
                </Select>
              </LabeledField>
              <LabeledField label={pt.amountLabel} htmlFor="adjust-amount">
                <input
                  id="adjust-amount"
                  type="number"
                  min={0}
                  className="min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body-lg text-fg"
                  placeholder="100"
                />
              </LabeledField>
              <LabeledField label={pt.reasonLabel} htmlFor="adjust-reason">
                <Textarea id="adjust-reason" rows={2} required />
              </LabeledField>
              <LabeledField label={pt.referenceLabel} htmlFor="adjust-reference">
                <input id="adjust-reference" className="min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body text-fg" />
              </LabeledField>
            </PreviewActionDialog>
          </div>
          {points.entries.length === 0 ? (
            <StatePanel title={pt.ledgerEmpty} />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[52rem] border-collapse text-body">
                <thead>
                  <tr className="border-b bg-surface-2/40 text-label text-fg-muted">
                    <th className="px-md py-2 text-start font-medium">{pt.columns.date}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.event}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.direction}</th>
                    <th className="px-md py-2 text-end font-medium">{pt.columns.amount}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.source}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.reason}</th>
                    <th className="px-md py-2 text-start font-medium">{pt.columns.actor}</th>
                    <th className="px-md py-2 text-end font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {points.entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="px-md py-2.5 text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</td>
                      <td className="px-md py-2.5">{e.eventType}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.pointsDelta >= 0 ? pt.creditLabel : pt.debitLabel}</td>
                      <td className={`px-md py-2.5 text-end tabular-nums ${e.pointsDelta >= 0 ? "text-success" : "text-danger"}`}>
                        {e.pointsDelta >= 0 ? "+" : ""}
                        {formatNumber(e.pointsDelta, locale)}
                      </td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.sourceType}</td>
                      <td className="px-md py-2.5 text-fg-secondary">{e.reasonCode ?? "—"}</td>
                      <td className="px-md py-2.5 text-fg-secondary">
                        {e.awardedByUserId ? (pointsActorNames.get(e.awardedByUserId) ?? pt.manual) : pt.automatic}
                      </td>
                      <td className="px-md py-2.5 text-end">
                        {!e.reversesEntryId ? (
                          <PreviewActionDialog trigger={pt.reverse} triggerVariant="ghost" title={pt.reverseTitle} body={pt.reverseBody} confirmLabel={pt.reverse} confirmVariant="danger">
                            <p className="text-label text-fg-muted">
                              {pt.originalTransaction}: {e.eventType} ({e.pointsDelta >= 0 ? "+" : ""}
                              {formatNumber(e.pointsDelta, locale)})
                            </p>
                            <p className="text-label text-fg-secondary">{pt.confirmReversal}</p>
                          </PreviewActionDialog>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "activity" && timeline ? (
        timeline.length === 0 ? (
          <StatePanel title={tl.empty} />
        ) : (
          <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
            {timeline.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2.5 odd:bg-surface-2/30">
                <span className="font-medium text-fg">{e.label}</span>
                {e.detail ? <span className="text-label text-fg-muted">· {e.detail}</span> : null}
                <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.at, locale)}</span>
              </li>
            ))}
          </ol>
        )
      ) : null}

      {tab === "notes" && notes ? (
        <section className="flex flex-col gap-md">
          <p className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">{nt.fixtureNotice}</p>
          {notes.length === 0 ? (
            <StatePanel title={nt.empty} />
          ) : (
            <div className="flex flex-col gap-sm">
              {notes.map((n) => (
                <Card key={n.id} pad="sm" className="flex flex-col gap-1">
                  <p className="text-body text-fg">{n.body}</p>
                  <p className="text-label text-fg-muted">
                    {n.author} · {formatDateTime(n.createdAt, locale)} · {nt.internalOnly}
                  </p>
                </Card>
              ))}
            </div>
          )}
          <Textarea rows={2} placeholder={nt.addPlaceholder} disabled />
        </section>
      ) : null}

      {tab === "audit" && auditEntries ? (
        auditEntries.length === 0 ? (
          <StatePanel title={m.admin.audit.empty} />
        ) : (
          <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
            {auditEntries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2.5 odd:bg-surface-2/30">
                {e.actorRole ? <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-label text-fg-muted">{e.actorRole}</span> : null}
                <span className="text-fg-secondary">{actionLabels[auditActionKey(e.action)] ?? e.action}</span>
                <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</span>
              </li>
            ))}
          </ol>
        )
      ) : null}

      {tab === "followup" && followUps ? (
        <section className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-md">
            <SectionTitle>{fu.historyTitle}</SectionTitle>
            <PreviewActionDialog trigger={fu.title} triggerVariant="accent" title={fu.title} confirmLabel={fu.submit} confirmVariant="accent">
              <LabeledField label={fu.actionType} htmlFor="followup-type">
                <Select id="followup-type" defaultValue="call">
                  <option value="call">{fu.types.call}</option>
                  <option value="whatsapp">{fu.types.whatsapp}</option>
                  <option value="email">{fu.types.email}</option>
                  <option value="verificationFollowUp">{fu.types.verificationFollowUp}</option>
                  <option value="other">{fu.types.other}</option>
                </Select>
              </LabeledField>
              <LabeledField label={fu.note} htmlFor="followup-note">
                <Textarea id="followup-note" rows={3} required />
              </LabeledField>
              <LabeledField label={fu.followUpDate} htmlFor="followup-date">
                <input id="followup-date" type="date" className="min-h-11 w-full rounded-md border border-strong bg-canvas px-3.5 text-body text-fg" />
              </LabeledField>
            </PreviewActionDialog>
          </div>
          <p className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">{fu.fixtureNotice}</p>
          {followUps.length === 0 ? (
            <StatePanel title={fu.historyEmpty} />
          ) : (
            <div className="flex flex-col gap-sm">
              {followUps.map((f) => (
                <Card key={f.id} pad="sm" className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-md">
                    <Badge tone="accent">{fu.types[f.type]}</Badge>
                    <span className="text-label text-fg-muted">{formatDateTime(f.createdAt, locale)}</span>
                  </div>
                  <p className="text-body text-fg">{f.note}</p>
                  <p className="text-label text-fg-muted">
                    {f.actor}
                    {f.followUpDate ? ` · ${fu.followUpDate}: ${formatAdminDate(f.followUpDate, locale)}` : ""}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "report" ? (
        <section className="flex flex-col gap-md">
          <Card className="flex flex-col gap-md">
            <SectionTitle>{rp.title}</SectionTitle>
            <p className="text-label text-fg-secondary">{rp.subtitle}</p>
            <LabeledField label={rp.subject} htmlFor="report-subject">
              <Input id="report-subject" defaultValue={user.displayName || m.admin.users.unnamed} disabled />
            </LabeledField>
            <LabeledField label={rp.contact} htmlFor="report-contact">
              <Input id="report-contact" placeholder={rp.contact} />
            </LabeledField>
            <LabeledField label={rp.description} htmlFor="report-description">
              <Textarea id="report-description" rows={4} required />
            </LabeledField>
            <LabeledField label={rp.attachment} htmlFor="report-attachment">
              <input id="report-attachment" type="file" className="text-label text-fg-secondary" disabled />
            </LabeledField>
            <div className="flex justify-end">
              <PreviewActionDialog trigger={rp.submit} triggerVariant="danger" title={rp.title} body={rp.subtitle} confirmLabel={rp.submit} confirmVariant="danger" />
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
