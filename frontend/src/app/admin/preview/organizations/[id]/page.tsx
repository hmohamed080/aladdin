import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getOrganizationDetail } from "@/server/queries/admin";
import {
  previewOrgTimeline,
  previewSubjectAudit,
  previewOrgOwners,
  previewOrgProvenance,
  previewOrgDuplicateCandidates,
} from "@/server/queries/admin-preview";
import { previewNotesFor } from "@/features/admin-preview/fixtures";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatDateTime, formatNumber } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { TabLinks } from "@/components/ui/stat-tiles";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { LabeledField, Textarea, ButtonLink } from "@/components/ui/controls";
import { requireAdminRoute } from "@/server/authorization/admin";

export const dynamic = "force-dynamic";

const PROVENANCE_LABEL_KEY: Record<string, "provenanceSelfCreated" | "provenanceSales" | "provenanceInstaller"> = {
  self_created: "provenanceSelfCreated",
  salesperson_referral: "provenanceSales",
  installer_referral: "provenanceInstaller",
};

/**
 * Phase 0 preview — Organization Details (BL-022's locked information
 * architecture): Overview / Members / Branches / Ownership / Verification /
 * Network-Referrals / Activity / Admin Notes / Audit. Real data everywhere
 * it exists; "Admin Notes" is the one fixture-backed tab (BL-008, no
 * backend). Suspend/Restore are preview-only dialogs (BL-002) — no real
 * mutation is possible from this page.
 */
export default async function PreviewOrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminRoute("/admin/preview/organizations");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam || "overview";
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const org = await getOrganizationDetail(supabase, id);
  if (!org) notFound();

  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const actionLabels = m.admin.actions as Record<string, string>;
  const t = m.admin.preview.organizations;
  const tl = m.admin.preview.timeline;
  const nt = m.admin.preview.notes;

  const owners = tab === "ownership" || tab === "overview" ? await previewOrgOwners(supabase, id) : null;
  const provenance = tab === "network" || tab === "overview" ? await previewOrgProvenance(supabase, id) : null;
  const timeline = tab === "activity" ? await previewOrgTimeline(supabase, id) : null;
  const auditEntries = tab === "audit" ? await previewSubjectAudit(supabase, "organization", id) : null;
  const notes = tab === "notes" ? previewNotesFor(id) : null;
  const duplicates =
    tab === "network" ? await previewOrgDuplicateCandidates(supabase, id, org.name, org.orgType as never) : null;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/preview/organizations" className="text-label text-accent hover:underline">
        ← {t.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <AdminHeader locale={locale} title={org.name} subtitle={typeLabels[org.orgType] ?? org.orgType} />
          <div className="flex items-center gap-2">
            <StatusBadge status={org.status} label={statusLabels[org.status] ?? org.status} />
            {org.isVerified ? <Badge tone="success">{m.admin.orgs.verified}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-sm">
          {org.status === "pending_verification" ? (
            <>
              <PreviewActionDialog trigger={t.rowActions.verify} triggerVariant="accent" title={m.admin.preview.orgOverview.availableActions} confirmLabel={t.rowActions.verify} confirmVariant="accent" />
              <PreviewActionDialog trigger={t.rowActions.reject} triggerVariant="danger" title={m.admin.preview.review.rejectTitle} body={m.admin.preview.review.rejectBody} confirmLabel={t.rowActions.reject} confirmVariant="danger" />
            </>
          ) : null}
          {org.status === "suspended" ? (
            <PreviewActionDialog trigger={t.restore} triggerVariant="outline" title={t.restoreTitle} body={t.restoreBody} confirmLabel={t.restore} confirmVariant="accent" />
          ) : (
            <PreviewActionDialog trigger={t.suspend} triggerVariant="danger" title={t.suspendTitle} body={t.suspendBody} confirmLabel={t.suspend} confirmVariant="danger">
              <LabeledField label={m.admin.preview.users.reasonLabel} htmlFor="org-suspend-reason">
                <Textarea id="org-suspend-reason" rows={3} required />
              </LabeledField>
            </PreviewActionDialog>
          )}
          <RowActionsMenu
            label={t.title}
            actions={
              [
                { kind: "link", label: t.rowActions.addNote, href: `/admin/preview/organizations/${id}?tab=notes` },
                { kind: "link", label: t.rowActions.audit, href: `/admin/preview/organizations/${id}?tab=audit` },
                { kind: "link", label: t.rowActions.viewOwner, href: `/admin/preview/organizations/${id}?tab=ownership` },
              ] satisfies RowAction[]
            }
          />
        </div>
      </div>

      <TabLinks
        basePath={`/admin/preview/organizations/${id}`}
        param="tab"
        current={tab === "overview" ? "" : tab}
        label={t.title}
        locale={locale}
        tabs={[
          { value: "", label: t.tabs.overview },
          { value: "members", label: t.tabs.members },
          { value: "branches", label: t.tabs.branches },
          { value: "ownership", label: t.tabs.ownership },
          { value: "verification", label: t.tabs.verification },
          { value: "network", label: t.tabs.network },
          { value: "activity", label: t.tabs.activity },
          { value: "notes", label: t.tabs.notes },
          { value: "audit", label: t.tabs.audit },
        ]}
      />

      {tab === "overview" ? (
        <div className="flex flex-col gap-lg">
          <Card>
            <dl className="grid gap-md tablet:grid-cols-4">
              <Field label={t.tabs.overview}>{typeLabels[org.orgType] ?? org.orgType}</Field>
              <Field label={m.admin.orgs.status}>{statusLabels[org.status] ?? org.status}</Field>
              <Field label={m.admin.orgs.verification}>{org.isVerified ? m.admin.orgs.verified : m.admin.orgs.notVerified}</Field>
              <Field label={m.admin.orgs.created}>{formatAdminDate(org.createdAt, locale)}</Field>
              <Field label={m.admin.orgs.members}>{formatNumber(org.members.length, locale)}</Field>
              <Field label={t.tabs.branches}>{formatNumber(org.branches.length, locale)}</Field>
              <Field label={t.ownershipTitle}>
                {owners && owners.length > 0 ? owners.map((o) => o.displayName || m.admin.users.unnamed).join(", ") : t.ownershipEmpty}
              </Field>
              {provenance ? (
                <Field label={t.provenanceTitle}>{t[PROVENANCE_LABEL_KEY[provenance.source] ?? "provenanceSelfCreated"]}</Field>
              ) : null}
            </dl>
          </Card>

          <Card className="flex flex-col gap-sm">
            <SectionTitle>{m.admin.preview.orgOverview.availableActions}</SectionTitle>
            <div className="flex flex-wrap gap-sm">
              {org.status === "pending_verification" ? (
                <>
                  <ButtonLink variant="accent" size="sm" href={`/admin/preview/organizations/${id}?tab=verification`}>
                    {t.rowActions.verify}
                  </ButtonLink>
                  <ButtonLink variant="danger" size="sm" href={`/admin/preview/organizations/${id}?tab=verification`}>
                    {t.rowActions.reject}
                  </ButtonLink>
                </>
              ) : null}
              <ButtonLink variant="outline" size="sm" href={`/admin/preview/organizations/${id}?tab=network`}>
                {m.admin.preview.orgOverview.linkDuplicate}
              </ButtonLink>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "members" ? (
        <section className="flex flex-col gap-md">
          {org.members.length === 0 ? (
            <StatePanel title={m.admin.orgs.noMembers} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.members.map((mem) => (
                <Card key={mem.membershipId} pad="sm" className="flex items-center justify-between gap-md">
                  <Link href={`/admin/preview/users/${mem.userId}`} className="min-w-0 truncate font-medium text-accent hover:underline">
                    {mem.displayName || m.admin.users.unnamed}
                  </Link>
                  <StatusBadge status={mem.status} label={statusLabels[mem.status] ?? mem.status} />
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "branches" ? (
        <section className="flex flex-col gap-md">
          {org.branches.length === 0 ? (
            <StatePanel title={m.admin.orgs.noBranches} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.branches.map((b) => (
                <Card key={b.id} pad="sm" className="flex items-center justify-between gap-md">
                  <span className="min-w-0 truncate font-medium text-fg">{b.name}</span>
                  <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? m.admin.orgs.branchActive : m.admin.orgs.branchInactive}</Badge>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "ownership" && owners ? (
        <section className="flex flex-col gap-md">
          <SectionTitle>{t.ownershipTitle}</SectionTitle>
          {owners.length === 0 ? (
            <StatePanel title={t.ownershipEmpty} />
          ) : (
            <div className="flex flex-col gap-sm">
              {owners.map((o) => (
                <Card key={o.userId} pad="sm">
                  <Link href={`/admin/preview/users/${o.userId}`} className="font-medium text-accent hover:underline">
                    {o.displayName || m.admin.users.unnamed}
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "verification" ? (
        <section className="flex flex-col gap-md">
          {org.verifications.length === 0 ? (
            <StatePanel title={m.admin.orgs.noVerifications} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.verifications.map((v) => (
                <Card key={v.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                  <div>
                    <p className="text-body font-medium text-fg">
                      {(m.admin.verificationType as Record<string, string>)[v.verificationType] ?? v.verificationType}
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

      {tab === "network" && provenance ? (
        <div className="flex flex-col gap-lg">
          <Card className="flex flex-col gap-md">
            <SectionTitle>{t.provenanceTitle}</SectionTitle>
            <dl className="grid gap-md tablet:grid-cols-2">
              <Field label={t.provenanceTitle}>{t[PROVENANCE_LABEL_KEY[provenance.source] ?? "provenanceSelfCreated"]}</Field>
              {provenance.referredByUserId ? (
                <Field label={t.referredBy}>
                  <Link href={`/admin/preview/users/${provenance.referredByUserId}`} className="text-accent hover:underline">
                    {provenance.referredByName || m.admin.users.unnamed}
                  </Link>
                </Field>
              ) : null}
            </dl>
          </Card>

          <Card className="flex flex-col gap-md">
            <SectionTitle>{m.admin.preview.duplicates.title}</SectionTitle>
            {!duplicates || duplicates.length === 0 ? (
              <p className="text-body text-fg-secondary">{m.admin.preview.duplicates.none}</p>
            ) : (
              <div className="flex flex-col gap-sm">
                {duplicates.map((d) => (
                  <Card key={d.id} pad="sm" className="flex flex-wrap items-center justify-between gap-md">
                    <div>
                      <Link href={`/admin/preview/organizations/${d.id}`} className="font-medium text-accent hover:underline">
                        {d.name}
                      </Link>
                      <p className="text-label text-fg-muted">
                        {d.similarity === 1 ? m.admin.preview.duplicates.whySameNameType : m.admin.preview.duplicates.whySimilarName}
                      </p>
                    </div>
                    <div className="flex gap-sm">
                      <ButtonLink variant="outline" size="sm" href={`/admin/preview/organizations/${d.id}`}>
                        {m.admin.preview.duplicates.inspect}
                      </ButtonLink>
                      <PreviewActionDialog
                        trigger={m.admin.preview.duplicates.linkExisting}
                        triggerVariant="accent"
                        title={m.admin.preview.duplicates.linkExisting}
                        confirmLabel={m.admin.preview.duplicates.linkExisting}
                        confirmVariant="accent"
                      />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </div>
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
    </div>
  );
}
