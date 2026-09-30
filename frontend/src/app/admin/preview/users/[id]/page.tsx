import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadUserDetail } from "@/server/queries/admin-directory";
import { previewUserPointsLedger, previewSubjectAudit } from "@/server/queries/admin-preview";
import { localizedName } from "@/features/admin-preview/directory-mappers";
import { can } from "@/lib/permissions/admin";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatDateTime, formatNumber } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { TabLinks } from "@/components/ui/stat-tiles";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { FollowUpPanel } from "@/features/admin-preview/follow-up-panel";
import { loadCases, loadFollowUpAssignees, loadFollowUps, loadNotes, loadSuspension, loadTimeline } from "@/server/queries/admin-operations";
import { SuspensionAction, SuspensionBanner } from "@/features/admin-ops/suspension";
import { CasesPanel, NotesPanel, TimelineList } from "@/features/admin-ops/panels";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { EyeIcon } from "@/components/ui/icons";
import { LabeledField, Textarea, Select, Input } from "@/components/ui/controls";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

/**
 * User Details — Admin Core Phase 1B-A reads + 1B-B operations. The approved
 * tab architecture (BL-021):
 *
 *   Overview · Profile · Organizations · Verification — `admin_user_detail`
 *     (platform users.read), one RPC.
 *   Suspend / Restore — live (users.suspend): reason, actor and time kept;
 *     the banner shows the open suspension.
 *   Points — only with `points.read`; the ledger reads through its own
 *     `points.read` RLS policy. Adjust / Reverse stay Preview dialogs (a
 *     later Points phase) and are drawn only for their permission holders.
 *   Audit — only with `audit.read` (its own RLS policy).
 *   Activity — the Entity Timeline (human-readable history, not raw Audit).
 *   Follow-up · Admin Notes · Report — live records, each gated by its own
 *     read / write permission (follow_ups.*, notes.*, cases.*).
 *   Verify / Reject in the header stay Preview here; decisions are made in
 *     Verifications.
 *
 * Opening this page never widens access: the nested panels check their own
 * permission server-side AND in the database.
 */
export default async function PreviewUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireAdminRoute("/admin/preview/users");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam || "overview";
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  const t = m.admin.preview.users;
  const d = m.admin.preview.directory;
  const loaded = await loadUserDetail(supabase, id);
  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-lg">
        <Link href="/admin/preview/users" className="text-label text-accent hover:underline">
          ← {t.title}
        </Link>
        <StatePanel title={d.detailLoadError} />
      </div>
    );
  }
  const user = loaded.data;
  if (!user) notFound();

  const canPoints = can(access, "points.read");
  const canAudit = can(access, "audit.read");
  const typeLabels = m.accountType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const actionLabels = m.admin.actions as Record<string, string>;
  const governorateLabels = m.onboarding.consumer.governorates as Record<string, string>;
  const cityLabels = m.onboarding.consumer.cities as Record<string, string>;
  const completionItemLabels = d.completionItems as Record<string, string>;
  const pt = m.admin.preview.points;
  const ov = m.admin.preview.userOverview;
  const platform = m.admin.preview.platformView;
  const rp = m.admin.preview.report;
  const fu = m.admin.preview.followUp;
  const name = localizedName(user.displayName, locale) || m.admin.users.unnamed;
  const platformHref = user.profileId && user.publicProfileAvailable ? `/p/${user.profileId}` : null;
  const location = user.governorate
    ? [governorateLabels[user.governorate] ?? user.governorate, user.city ? (cityLabels[user.city] ?? user.city) : null].filter(Boolean).join(" · ")
    : null;
  const firstOrg = user.memberships.find((mm) => mm.status === "active") ?? user.memberships[0];
  const headerMoreActions: RowAction[] = [
    { kind: "link", label: t.rowActions.addNote, href: `/admin/preview/users/${id}?tab=notes` },
    { kind: "link", label: t.rowActions.followUp, href: `/admin/preview/users/${id}?tab=followup` },
    { kind: "link", label: t.rowActions.report, href: `/admin/preview/users/${id}?tab=report` },
    ...(canAudit ? [{ kind: "link" as const, label: t.rowActions.audit, href: `/admin/preview/users/${id}?tab=audit` }] : []),
    ...(firstOrg ? [{ kind: "link" as const, label: t.rowActions.viewOrg, href: `/admin/preview/organizations/${firstOrg.organization.id}` }] : []),
  ];

  const points = canPoints && (tab === "points" || tab === "overview") ? await previewUserPointsLedger(supabase, user.id) : null;
  let pointsActorNames = new Map<string, string>();
  if (points && points.entries.length > 0) {
    const actorIds = Array.from(new Set(points.entries.flatMap((e) => (e.awardedByUserId ? [e.awardedByUserId] : []))));
    if (actorIds.length > 0) {
      const { data: actorProfiles } = await supabase.from("profiles").select("user_id, display_name").in("user_id", actorIds);
      pointsActorNames = new Map((actorProfiles ?? []).map((r) => [r.user_id, r.display_name]));
    }
  }
  // Phase 1B-B operational reads: each tab loads only its own data, and only
  // when the caller holds that record's read permission (else a locked state).
  const canSuspend = can(access, "users.suspend");
  const suspension = user.status === "suspended" ? await loadSuspension(supabase, "user", user.id) : null;
  const timeline = tab === "activity" ? await loadTimeline(supabase, "user", user.id) : null;
  const notes = tab === "notes" && can(access, "notes.read") ? await loadNotes(supabase, "user", user.id) : null;
  const followUps = tab === "followup" && can(access, "follow_ups.read") ? await loadFollowUps(supabase, "user", user.id) : null;
  const assignees = tab === "followup" && can(access, "follow_ups.manage") ? ((await loadFollowUpAssignees(supabase)) ?? []) : [];
  const cases = tab === "report" && can(access, "cases.read") ? await loadCases(supabase, "user", user.id) : null;
  const auditEntries = canAudit && tab === "audit" ? await previewSubjectAudit(supabase, "user", user.id) : null;

  const flags: string[] = [];
  if (user.status === "suspended") flags.push(statusLabels.suspended ?? user.status);
  if (user.verificationState === "rejected") flags.push(t.flagLabels.verification_issue);

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/preview/users" className="text-label text-accent hover:underline">
        ← {t.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <AdminHeader locale={locale} title={name} subtitle={user.headline ?? undefined} />
          <div className="flex items-center gap-2">
            <StatusBadge status={user.status} label={statusLabels[user.status] ?? user.status} />
            {user.isVerified ? <Badge tone="success">{m.admin.users.verified}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          {platformHref ? (
            <a
              href={platformHref}
              target="_blank"
              rel="noopener noreferrer"
              title={platform.viewOnPlatformHint}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-strong px-3.5 text-body font-medium text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <EyeIcon size={16} />
              {platform.viewOnPlatform}
            </a>
          ) : (
            <span
              aria-disabled="true"
              title={platform.notListed}
              className="inline-flex min-h-10 cursor-not-allowed items-center gap-1.5 rounded-md border px-3.5 text-body font-medium text-fg-muted opacity-50"
            >
              <EyeIcon size={16} />
              {platform.viewOnPlatform}
            </span>
          )}
          {user.status === "pending_verification" ? (
            <>
              <PreviewActionDialog trigger={ov.verify} triggerVariant="accent" title={ov.verify} confirmLabel={ov.verify} confirmVariant="accent" />
              <PreviewActionDialog trigger={ov.reject} triggerVariant="danger" title={m.admin.preview.review.rejectTitle} body={m.admin.preview.review.rejectBody} confirmLabel={ov.reject} confirmVariant="danger" />
            </>
          ) : null}
          {canSuspend && user.status !== "deactivated" ? (
            <SuspensionAction m={m} subjectType="user" subjectId={user.id} suspended={user.status === "suspended"} />
          ) : null}
          <RowActionsMenu label={t.moreActions} actions={headerMoreActions} />
        </div>
      </div>

      {user.status === "suspended" ? <SuspensionBanner m={m} locale={locale} subjectType="user" suspension={suspension} /> : null}

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
          { value: "followup", label: fu.title },
          { value: "report", label: rp.title },
          { value: "notes", label: t.tabs.notes },
          { value: "audit", label: t.tabs.audit },
        ]}
      />

      {tab === "overview" ? (
        <div className="flex flex-col gap-lg">
          <Card>
            <dl className="grid gap-md tablet:grid-cols-3">
              <Field label={m.admin.users.type}>
                {user.accountType ? (typeLabels[user.accountType] ?? user.accountType) : m.admin.users.businessOnly}
              </Field>
              <Field label={m.admin.users.status}>{statusLabels[user.status] ?? user.status}</Field>
              <Field label={m.admin.users.joined}>{formatAdminDate(user.createdAt, locale)}</Field>
              <Field label={d.lastSignIn}>{user.lastSignInAt ? formatDateTime(user.lastSignInAt, locale) : d.neverSignedIn}</Field>
              <Field label={ov.organizationsSummary}>{formatNumber(user.memberships.length, locale)}</Field>
              <Field label={d.completion}>{formatNumber(user.completion.percent, locale)}%</Field>
              {points ? <Field label={ov.pointsSummary}>{formatNumber(points.balance, locale)}</Field> : null}
            </dl>
          </Card>

          <Card className="flex flex-col gap-sm">
            <SectionTitle>{ov.recentFlags}</SectionTitle>
            {flags.length === 0 ? (
              <p className="text-body text-fg-secondary">{ov.noFlags}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {flags.map((f) => (
                  <Badge key={f} tone="warning">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="flex flex-col gap-lg">
          <Card>
            <dl className="grid gap-md tablet:grid-cols-2">
              <Field label={m.admin.users.name}>{name}</Field>
              <Field label={d.username}>{user.username ? <span dir="ltr">@{user.username}</span> : d.notProvided}</Field>
              <Field label={d.email}>{user.email ? <span dir="ltr">{user.email}</span> : d.notProvided}</Field>
              <Field label={d.phone}>{user.phone ? <span dir="ltr">{user.phone}</span> : d.notProvided}</Field>
              <Field label={d.location}>{location ?? d.notProvided}</Field>
              <Field label={d.headline}>{user.headline ?? d.notProvided}</Field>
              <Field label={d.bio}>{user.bio ?? d.notProvided}</Field>
            </dl>
          </Card>
          <Card className="flex flex-col gap-sm">
            <SectionTitle>
              {d.completion}: {formatNumber(user.completion.percent, locale)}%
            </SectionTitle>
            {user.completion.missing.length === 0 ? (
              <p className="text-body text-fg-secondary">{d.completionComplete}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-label text-fg-muted">{d.completionMissing}</p>
                <div className="flex flex-wrap gap-1.5">
                  {user.completion.missing.map((k) => (
                    <Badge key={k} tone="neutral">
                      {completionItemLabels[k] ?? k}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
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
                    <Link href={`/admin/preview/organizations/${mm.organization.id}`} className="font-medium text-accent hover:underline">
                      {localizedName(mm.organization, locale)}
                    </Link>
                    <StatusBadge status={mm.status} label={statusLabels[mm.status] ?? mm.status} />
                  </div>
                  {mm.capabilities.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5" aria-label={d.capabilities}>
                      {mm.capabilities.map((c) => (
                        <span key={c} dir="ltr" className="rounded-pill bg-surface-2 px-2 py-0.5 text-label text-fg-secondary">
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
                    <p className="text-label text-fg-muted">
                      {formatAdminDate(v.submittedAt, locale)}
                      {v.reason ? ` · ${v.reason}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={v.status} label={statusLabels[v.status] ?? v.status} />
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "points" && !canPoints ? <StatePanel title={d.pointsLocked} /> : null}
      {tab === "points" && points ? (
        <section className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-md">
            <SectionTitle>
              {pt.summary}: {formatNumber(points.balance, locale)}
            </SectionTitle>
            {can(access, "points.adjust") ? (
              <PreviewActionDialog trigger={pt.adjust} title={pt.adjustTitle} body={pt.adjustBody} confirmLabel={pt.adjust} confirmVariant="accent">
                <LabeledField label={pt.direction} htmlFor="adjust-direction">
                  <Select id="adjust-direction" defaultValue="credit">
                    <option value="credit">{pt.creditLabel}</option>
                    <option value="debit">{pt.debitLabel}</option>
                  </Select>
                </LabeledField>
                <LabeledField label={pt.amountLabel} htmlFor="adjust-amount">
                  <Input id="adjust-amount" type="number" min={0} placeholder="100" />
                </LabeledField>
                <LabeledField label={pt.reasonLabel} htmlFor="adjust-reason">
                  <Textarea id="adjust-reason" rows={2} required />
                </LabeledField>
                <LabeledField label={pt.referenceLabel} htmlFor="adjust-reference">
                  <Input id="adjust-reference" />
                </LabeledField>
              </PreviewActionDialog>
            ) : null}
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
                        {!e.reversesEntryId && can(access, "points.reverse") ? (
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

      {tab === "activity" ? <TimelineList m={m} locale={locale} events={timeline} /> : null}
      {tab === "followup" ? (
        <FollowUpPanel
          m={m}
          locale={locale}
          subjectType="user"
          subjectId={user.id}
          followUps={can(access, "follow_ups.read") ? followUps : null}
          assignees={assignees}
          canManage={can(access, "follow_ups.manage")}
        />
      ) : null}
      {tab === "notes" ? (
        <NotesPanel m={m} locale={locale} subjectType="user" subjectId={user.id} notes={notes} canCreate={can(access, "notes.create")} />
      ) : null}

      {tab === "audit" && !canAudit ? <StatePanel title={d.auditLocked} /> : null}
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

      {tab === "report" ? (
        <CasesPanel
          m={m}
          locale={locale}
          subjectType="user"
          subjectId={user.id}
          cases={cases}
          canCreate={can(access, "cases.create")}
          defaults={{ subject: name, name, phone: user.phone ?? "", email: user.email ?? "" }}
        />
      ) : null}
    </div>
  );
}
