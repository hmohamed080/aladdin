import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadOrganizationDetail } from "@/server/queries/admin-directory";
import { previewSubjectAudit } from "@/server/queries/admin-preview";
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
 * Organization Details — Admin Core Phase 1B-A. The approved tab architecture
 * (BL-022) over REAL reads:
 *
 *   Overview · Members · Branches · Ownership · Verification · Network
 *     (provenance) — `admin_organization_detail` (platform organizations.read).
 *     Ownership = active members holding org.manage; no separate ownership
 *     record exists.
 *   Audit — only with `audit.read` (its own RLS policy).
 *   Activity — no organization activity source for Admin; honest empty state.
 *   Admin Notes · duplicate candidates — Phase 1B-B; honest deferred states.
 */
export default async function PreviewOrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireAdminRoute("/admin/preview/organizations");
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam || "overview";
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  const t = m.admin.preview.organizations;
  const d = m.admin.preview.directory;
  const loaded = await loadOrganizationDetail(supabase, id);
  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-lg">
        <Link href="/admin/preview/organizations" className="text-label text-accent hover:underline">
          ← {t.title}
        </Link>
        <StatePanel title={d.detailLoadError} />
      </div>
    );
  }
  const org = loaded.data;
  if (!org) notFound();

  const canAudit = can(access, "audit.read");
  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const actionLabels = m.admin.actions as Record<string, string>;
  const name = localizedName(org, locale);
  const provenance = t[PROVENANCE_LABEL_KEY[org.source ?? ""] ?? "provenanceSelfCreated"];
  const auditEntries = canAudit && tab === "audit" ? await previewSubjectAudit(supabase, "organization", org.id) : null;
  const activeMembers = org.members.filter((mem) => mem.status === "active").length;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/preview/organizations" className="text-label text-accent hover:underline">
        ← {t.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <AdminHeader locale={locale} title={name} subtitle={typeLabels[org.orgType] ?? org.orgType} />
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
                ...(canAudit ? [{ kind: "link" as const, label: t.rowActions.audit, href: `/admin/preview/organizations/${id}?tab=audit` }] : []),
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
              <Field label={m.admin.orgs.members}>{formatNumber(activeMembers, locale)}</Field>
              <Field label={t.tabs.branches}>{formatNumber(org.branches.length, locale)}</Field>
              <Field label={t.ownershipTitle}>
                {org.owners.length > 0 ? org.owners.map((o) => o.displayName || m.admin.users.unnamed).join(", ") : t.ownershipEmpty}
              </Field>
              <Field label={t.provenanceTitle}>{provenance}</Field>
            </dl>
          </Card>

          {org.status === "pending_verification" ? (
            <Card className="flex flex-col gap-sm">
              <SectionTitle>{m.admin.preview.orgOverview.availableActions}</SectionTitle>
              <div className="flex flex-wrap gap-sm">
                <ButtonLink variant="accent" size="sm" href={`/admin/preview/organizations/${id}?tab=verification`}>
                  {t.rowActions.verify}
                </ButtonLink>
                <ButtonLink variant="danger" size="sm" href={`/admin/preview/organizations/${id}?tab=verification`}>
                  {t.rowActions.reject}
                </ButtonLink>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "members" ? (
        <section className="flex flex-col gap-md">
          {org.members.length === 0 ? (
            <StatePanel title={m.admin.orgs.noMembers} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.members.map((mem) => (
                <Card key={mem.membershipId} pad="sm" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-md">
                    <Link href={`/admin/preview/users/${mem.userId}`} className="min-w-0 truncate font-medium text-accent hover:underline">
                      {mem.displayName || m.admin.users.unnamed}
                    </Link>
                    <StatusBadge status={mem.status} label={statusLabels[mem.status] ?? mem.status} />
                  </div>
                  {mem.capabilities.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5" aria-label={d.capabilities}>
                      {mem.capabilities.map((c) => (
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

      {tab === "branches" ? (
        <section className="flex flex-col gap-md">
          {org.branches.length === 0 ? (
            <StatePanel title={m.admin.orgs.noBranches} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.branches.map((b) => (
                <Card key={b.id} pad="sm" className="flex items-center justify-between gap-md">
                  <span className="min-w-0 truncate font-medium text-fg">{localizedName(b, locale)}</span>
                  <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? m.admin.orgs.branchActive : m.admin.orgs.branchInactive}</Badge>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "ownership" ? (
        <section className="flex flex-col gap-md">
          <SectionTitle>{t.ownershipTitle}</SectionTitle>
          {org.owners.length === 0 ? (
            <StatePanel title={t.ownershipEmpty} />
          ) : (
            <div className="flex flex-col gap-sm">
              {org.owners.map((o) => (
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

      {tab === "network" ? (
        <div className="flex flex-col gap-lg">
          <Card className="flex flex-col gap-md">
            <SectionTitle>{t.provenanceTitle}</SectionTitle>
            <dl className="grid gap-md tablet:grid-cols-2">
              <Field label={t.provenanceTitle}>{provenance}</Field>
              {org.referredBy ? (
                <Field label={t.referredBy}>
                  <Link href={`/admin/preview/users/${org.referredBy.userId}`} className="text-accent hover:underline">
                    {org.referredBy.displayName || m.admin.users.unnamed}
                  </Link>
                </Field>
              ) : null}
            </dl>
          </Card>
          <Card className="flex flex-col gap-sm">
            <SectionTitle>{m.admin.preview.duplicates.title}</SectionTitle>
            <p className="text-body text-fg-secondary">{d.duplicatesDeferred}</p>
          </Card>
        </div>
      ) : null}

      {tab === "activity" ? <StatePanel title={d.activityUnavailable} /> : null}
      {tab === "notes" ? <StatePanel title={d.notesDeferred} /> : null}

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
    </div>
  );
}
