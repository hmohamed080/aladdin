import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { listOrganizations } from "@/server/queries/admin";
import { previewOrgsDirectoryContext, flagDuplicateOrgNames } from "@/server/queries/admin-preview";
import { previewCityFor, previewContactFor, previewCompletenessFor } from "@/features/admin-preview/fixtures";
import { whatsappShareUrl } from "@/lib/contact/whatsapp";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatCount, formatNumber } from "@/lib/ui/format";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { Badge, StatePanel, Card } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";
import { DataTable, RecordCell, Monogram, ListFooter, type Column } from "@/components/ui/data-table";
import { TabLinks } from "@/components/ui/stat-tiles";
import { RowActionsMenu, type RowAction } from "@/features/admin-preview/row-actions-menu";
import { RowIconLink } from "@/features/admin-preview/row-icon-button";
import { RowIconAction } from "@/features/admin-preview/row-icon-action";
import { AutoFilters, SortableHeader } from "@/features/admin-preview/auto-filters";
import { PreviewLegend, PREVIEW_MARK } from "@/features/admin-preview/preview-legend";
import { EyeIcon, WhatsAppIcon, CheckIcon, XIcon, AlertIcon } from "@/components/ui/icons";
import type { AdminOrgRow } from "@/server/queries/admin";

export const dynamic = "force-dynamic";

type OrgFlagCode = "possible_duplicate" | "incomplete_critical_profile";

type Row = AdminOrgRow & {
  ownerName: string | null;
  branchCount: number;
  source: string | null;
  referredByName: string | null;
  city: string;
  phone: string;
  completeness: number;
  duplicate: boolean;
  verificationState: "verified" | "pending" | "unverified";
  flags: OrgFlagCode[];
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

const disabledPagerClass =
  "inline-flex min-h-8 select-none items-center justify-center rounded-sm px-3 py-1 text-label font-medium text-fg-muted opacity-50";

function pagerHref(keep: Record<string, string | undefined>, page: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `?${s}` : "?";
}

/**
 * Phase 0C — Organizations Directory brought to the same standard as Users
 * (refining Phase 0B's page in place — no parallel surface). Real:
 * `listOrganizations()`, `previewOrgsDirectoryContext()` (owner/branches/
 * provenance), the directory-wide duplicate flag (`flagDuplicateOrgNames()`,
 * the same exact-normalized-name signal the detail page's Network tab
 * uses). Fixture, clearly marked: phone/WhatsApp, city, profile completion
 * (no completeness engine exists for organizations at all today — this is a
 * deterministic placeholder for the future field, not a real computation).
 * Auto search/filters, 10-row default pagination, visible row-action icons —
 * same conventions as the Users Directory.
 */
export default async function PreviewOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; city?: string; flag?: string; page?: string; pageSize?: string; sort?: string }>;
}) {
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const { q, status, type, city, flag, page: pageParam, pageSize: pageSizeParam, sort } = await searchParams;

  const allOrgs = await listOrganizations(supabase);
  const query = (q ?? "").trim().toLowerCase();
  const searched = allOrgs.filter((o) => !query || o.name.toLowerCase().includes(query));

  const context = await previewOrgsDirectoryContext(supabase, searched.map((o) => o.id));
  const duplicateIds = flagDuplicateOrgNames(searched.map((o) => ({ id: o.id, name: o.name, orgType: o.orgType })));

  const rows: Row[] = searched.map((o) => {
    const ctx = context.get(o.id);
    const completeness = previewCompletenessFor(o.id);
    const duplicate = duplicateIds.has(o.id);
    const verificationState: Row["verificationState"] = o.isVerified ? "verified" : o.status === "pending_verification" ? "pending" : "unverified";
    const flags: OrgFlagCode[] = [];
    if (duplicate) flags.push("possible_duplicate");
    if (completeness < 70) flags.push("incomplete_critical_profile");
    return {
      ...o,
      ownerName: ctx?.ownerName ?? null,
      branchCount: ctx?.branchCount ?? 0,
      source: ctx?.source ?? null,
      referredByName: ctx?.referredByName ?? null,
      city: previewCityFor(o.id),
      phone: previewContactFor(o.id).phone,
      completeness,
      duplicate,
      verificationState,
      flags,
    };
  });

  const tabValue = (r: Row) => {
    if (r.status === "suspended") return "suspended";
    if (r.status === "active") return "verified";
    if (r.status === "pending_verification") return "pending";
    return "";
  };
  const tabCounts = { pending: 0, verified: 0, suspended: 0, rejected: 0 };
  for (const r of rows) {
    const v = tabValue(r);
    if (v && v in tabCounts) tabCounts[v as keyof typeof tabCounts]++;
  }
  const duplicateCount = rows.filter((r) => r.duplicate).length;
  const incompleteCount = rows.filter((r) => r.completeness < 70).length;

  let filtered = rows.filter((r) => !status || tabValue(r) === status);
  if (type) filtered = filtered.filter((r) => r.orgType === type);
  if (city) filtered = filtered.filter((r) => r.city === city);
  if (flag === "duplicate") filtered = filtered.filter((r) => r.duplicate);
  if (flag === "incomplete") filtered = filtered.filter((r) => r.completeness < 70);

  const [sortField, sortDir] = (sort ?? "").split(":");
  if (sortField === "registered") {
    filtered = [...filtered].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (sortDir === "desc") filtered.reverse();
  } else if (sortField === "completeness") {
    filtered = [...filtered].sort((a, b) => a.completeness - b.completeness);
    if (sortDir === "desc") filtered.reverse();
  }

  const pageSize = PAGE_SIZES.includes(Number(pageSizeParam) as (typeof PAGE_SIZES)[number]) ? Number(pageSizeParam) : 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number(pageParam) || 1), totalPages);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const typeLabels = m.orgType as Record<string, string>;
  const statusLabels = m.admin.status as Record<string, string>;
  const verificationStateLabels = m.admin.preview.users.verificationState;
  const flagLabels = m.admin.preview.users.flagLabels;
  const warnings = m.admin.preview.users.warnings;
  const cols = m.admin.preview.organizations.columns;
  const rowActionLabels = m.admin.preview.organizations.rowActions;
  const keep = { q, status, type, city, flag, pageSize: pageSizeParam, sort };

  const provenanceLabel = (source: string | null) => {
    if (source === "salesperson_referral") return m.admin.preview.organizations.provenanceSales;
    if (source === "installer_referral") return m.admin.preview.organizations.provenanceInstaller;
    return m.admin.preview.organizations.provenanceSelfCreated;
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: cols.name,
      grow: true,
      cell: (o) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <RecordCell title={o.name} href={`/admin/preview/organizations/${o.id}`} avatar={<Monogram name={o.name} size={28} />} />
          {o.flags.length > 0 ? (
            <span title={o.flags.map((f) => flagLabels[f]).join(", ")} aria-hidden="true" className="shrink-0 text-warning">
              ●
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "type", header: cols.type, cell: (o) => typeLabels[o.orgType] ?? o.orgType },
    {
      key: "owner",
      header: cols.owner,
      secondary: true,
      cell: (o) => o.ownerName || <span className="text-fg-muted">{m.admin.preview.organizations.noOwner}</span>,
    },
    {
      key: "phone",
      header: `${m.admin.preview.users.columns.phone}${PREVIEW_MARK}`,
      secondary: true,
      cell: (o) => (
        <span className="flex items-center gap-1.5">
          <span dir="ltr" className="truncate text-label">{o.phone}</span>
          <RowIconLink href={whatsappShareUrl({ phone: o.phone, message: `Hi ${o.name}` })} label={m.admin.preview.users.rowActions.whatsapp} Icon={WhatsAppIcon} tone="success" external />
        </span>
      ),
    },
    { key: "city", header: `${m.admin.preview.users.columns.city}${PREVIEW_MARK}`, secondary: true, cell: (o) => o.city },
    { key: "verification", header: cols.verification ?? m.admin.orgs.verification, cell: (o) => <StatusBadge status={o.verificationState} label={verificationStateLabels[o.verificationState]} /> },
    {
      key: "members",
      header: cols.members,
      numeric: true,
      secondary: true,
      cell: (o) => formatNumber(o.memberCount, locale),
    },
    { key: "branches", header: cols.branches, numeric: true, secondary: true, cell: (o) => formatNumber(o.branchCount, locale) },
    {
      key: "status",
      header: cols.status,
      cell: (o) => <StatusBadge status={o.status} label={statusLabels[o.status] ?? o.status} />,
    },
    {
      key: "created",
      header: <SortableHeader field="registered" label={cols.created} />,
      secondary: true,
      cell: (o) => formatAdminDate(o.createdAt, locale),
    },
    {
      key: "completeness",
      header: <SortableHeader field="completeness" label={`${m.admin.preview.users.columns.completeness}${PREVIEW_MARK}`} />,
      secondary: true,
      cell: (o) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-12 overflow-hidden rounded-pill bg-surface-2">
            <span className="block h-full rounded-pill bg-accent-solid" style={{ width: `${o.completeness}%` }} />
          </span>
          <span className="tabular-nums">{formatNumber(o.completeness, locale)}%</span>
        </span>
      ),
    },
    { key: "provenance", header: cols.provenance, secondary: true, cell: (o) => provenanceLabel(o.source) },
    {
      key: "flags",
      header: m.admin.preview.users.columns.flags,
      secondary: true,
      cell: (o) =>
        o.flags.length === 0 ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {o.flags.map((f) => (
              <Badge key={f} tone="warning">
                {flagLabels[f]}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      cell: (o) => {
        const more: RowAction[] = [];
        if (o.duplicate) more.push({ kind: "link", label: rowActionLabels.inspectDuplicate, href: `/admin/preview/organizations/${o.id}?tab=network` });
        more.push({ kind: "link", label: rowActionLabels.viewOwner, href: `/admin/preview/organizations/${o.id}?tab=ownership` });
        more.push({ kind: "link", label: rowActionLabels.viewMembers, href: `/admin/preview/organizations/${o.id}?tab=members` });
        more.push({ kind: "link", label: rowActionLabels.viewNetwork, href: `/admin/preview/organizations/${o.id}?tab=network` });
        more.push({ kind: "link", label: rowActionLabels.addNote, href: `/admin/preview/organizations/${o.id}?tab=notes` });
        more.push({ kind: "link", label: rowActionLabels.audit, href: `/admin/preview/organizations/${o.id}?tab=audit` });

        return (
          <span className="flex items-center justify-end gap-0.5">
            <RowIconLink href={`/admin/preview/organizations/${o.id}`} label={rowActionLabels.view} Icon={EyeIcon} />
            {o.status === "pending_verification" ? (
              <>
                <RowIconAction
                  label={rowActionLabels.verify}
                  icon={<CheckIcon size={16} />}
                  tone="success"
                  title={m.admin.preview.orgOverview.availableActions}
                  confirmLabel={rowActionLabels.verify}
                  confirmVariant="primary"
                />
                <RowIconAction
                  label={rowActionLabels.reject}
                  icon={<XIcon size={16} />}
                  tone="danger"
                  title={m.admin.preview.review.rejectTitle}
                  body={m.admin.preview.review.rejectBody}
                  confirmLabel={rowActionLabels.reject}
                  confirmVariant="danger"
                />
              </>
            ) : o.status === "suspended" ? (
              <RowIconAction
                label={rowActionLabels.restore}
                icon={<CheckIcon size={16} />}
                tone="success"
                title={m.admin.preview.organizations.restoreTitle}
                body={m.admin.preview.organizations.restoreBody}
                confirmLabel={rowActionLabels.restore}
                confirmVariant="primary"
              />
            ) : (
              <RowIconAction
                label={rowActionLabels.suspend}
                icon={<AlertIcon size={16} />}
                tone="danger"
                title={m.admin.preview.organizations.suspendTitle}
                body={m.admin.preview.organizations.suspendBody}
                confirmLabel={rowActionLabels.suspend}
                confirmVariant="danger"
              />
            )}
            <RowActionsMenu label={m.admin.preview.organizations.title} actions={more} />
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <AdminHeader locale={locale} title={m.admin.preview.organizations.title} subtitle={m.admin.preview.organizations.detailSubtitle} count={filtered.length} />
      <p className="-mt-2 text-label text-fg-muted">{m.admin.preview.users.previewTotalNote}</p>

      {duplicateCount > 0 || incompleteCount > 0 ? (
        <Card pad="sm" className="flex flex-col gap-1.5">
          <p className="text-label font-medium text-fg-secondary">{warnings.title}</p>
          <div className="flex flex-wrap gap-sm">
            {duplicateCount > 0 ? (
              <a href={pagerHref({ ...keep, flag: "duplicate" }, 1)} className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20">
                {warnings.duplicates.replace("{count}", formatCount(duplicateCount, locale))}
              </a>
            ) : null}
            {incompleteCount > 0 ? (
              <a href={pagerHref({ ...keep, flag: "incomplete" }, 1)} className="rounded-pill bg-warning/10 px-3 py-1 text-label text-fg hover:bg-warning/20">
                {warnings.incompleteProfiles.replace("{count}", formatCount(incompleteCount, locale))}
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      <TabLinks
        basePath="/admin/preview/organizations"
        param="status"
        current={status ?? ""}
        locale={locale}
        keep={keep}
        label={m.admin.preview.users.statusTabs.all}
        tabs={[
          { value: "", label: m.admin.preview.users.statusTabs.all, count: rows.length },
          { value: "pending", label: m.admin.preview.users.statusTabs.pending, count: tabCounts.pending },
          { value: "verified", label: m.admin.preview.users.statusTabs.verified, count: tabCounts.verified },
          { value: "suspended", label: m.admin.preview.users.statusTabs.suspended, count: tabCounts.suspended },
        ]}
      />

      <AutoFilters
        fields={[
          { kind: "text", name: "q", placeholder: m.admin.preview.organizations.searchPlaceholder },
          {
            kind: "select",
            name: "type",
            anyLabel: m.admin.preview.users.anyType,
            options: Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
          },
          {
            kind: "select",
            name: "city",
            anyLabel: m.admin.preview.users.anyCity,
            options: Array.from(new Set(rows.map((r) => r.city))).map((c) => ({ value: c, label: c })),
          },
          {
            kind: "select",
            name: "pageSize",
            anyLabel: `${m.admin.preview.users.pagination.pageSize}: 10`,
            options: PAGE_SIZES.filter((n) => n !== 10).map((n) => ({ value: String(n), label: `${m.admin.preview.users.pagination.pageSize}: ${n}` })),
          },
        ]}
      />

      <PreviewLegend>{m.admin.preview.previewFieldNote}</PreviewLegend>

      {filtered.length === 0 ? (
        <StatePanel title={m.admin.preview.organizations.empty} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={paged}
            rowKey={(o) => o.id}
            caption={m.admin.preview.organizations.title}
            empty={<StatePanel title={m.admin.preview.organizations.empty} />}
          />
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <ListFooter>
              {m.admin.preview.users.pagination.showing
                .replace("{from}", formatCount(filtered.length === 0 ? 0 : (page - 1) * pageSize + 1, locale))
                .replace("{to}", formatCount(Math.min(page * pageSize, filtered.length), locale))
                .replace("{total}", formatCount(filtered.length, locale))}
            </ListFooter>
            <div className="flex gap-1.5">
              {page <= 1 ? (
                <span aria-disabled="true" className={cn(disabledPagerClass)}>
                  {m.admin.preview.users.pagination.previous}
                </span>
              ) : (
                <ButtonLink variant="outline" size="sm" href={pagerHref(keep, page - 1)}>
                  {m.admin.preview.users.pagination.previous}
                </ButtonLink>
              )}
              {page >= totalPages ? (
                <span aria-disabled="true" className={cn(disabledPagerClass)}>
                  {m.admin.preview.users.pagination.next}
                </span>
              ) : (
                <ButtonLink variant="outline" size="sm" href={pagerHref(keep, page + 1)}>
                  {m.admin.preview.users.pagination.next}
                </ButtonLink>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
