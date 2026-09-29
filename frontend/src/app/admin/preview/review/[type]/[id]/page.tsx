import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listVerifications,
  listAdminReferrals,
  listAdminNetworkReferrals,
  previewSubjectAudit,
  previewUserTimeline,
  previewOrgTimeline,
} from "@/server/queries/admin-preview";
import { PREVIEW_REASON_CODES, previewNotesFor } from "@/features/admin-preview/fixtures";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatAdminDate, formatDateTime } from "@/lib/ui/format";
import { auditActionKey } from "@/lib/admin/audit-actions";
import { AdminHeader } from "@/features/admin/parts";
import { Card, Badge, Field, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { PreviewActionDialog } from "@/features/admin-preview/preview-action-dialog";
import { LabeledField, Select, Textarea } from "@/components/ui/controls";

export const dynamic = "force-dynamic";

type ReviewType = "verification" | "sales-referral" | "network-referral";

/**
 * Phase 0 preview — Review Details. Real submission data (from the same
 * queues `/admin/verifications` already reads), including the existing
 * duplicate-candidate hint on referrals. Approve/Reject are preview-only
 * dialogs — the reject dialog previews PD-005's approved reason-code
 * taxonomy plus an internal note, neither of which has a backend column yet
 * (BL-010).
 */
export default async function PreviewReviewDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  const supabase = await getServerSupabase();
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = m.admin.preview.review;
  const reasonCodeLabels = t.reasonCodes as Record<string, string>;

  if (type !== "verification" && type !== "sales-referral" && type !== "network-referral") notFound();
  const reviewType = type as ReviewType;

  let title = "";
  let typeLabel = "";
  let submittedBy: string | null = null;
  let submittedOn = "";
  let fields: { label: string; value: string }[] = [];
  let match: { name: string | null; count: number } | null = null;
  let relatedUserId: string | null = null;
  let relatedUserName: string | null = null;
  let relatedOrgId: string | null = null;
  let relatedOrgName: string | null = null;
  let contactData: string | null = null;
  let previousDecisions: { status: string; at: string }[] = [];

  if (reviewType === "verification") {
    const rows = await listVerifications(supabase, false);
    const row = rows.find((r) => r.id === id);
    if (!row) notFound();
    title = row.subjectName;
    typeLabel = t.typeVerification;
    submittedOn = formatAdminDate(row.submittedAt, locale);
    fields = [
      { label: m.admin.users.type, value: (m.admin.verificationType as Record<string, string>)[row.verificationType] ?? row.verificationType },
      { label: m.admin.users.status, value: (m.admin.status as Record<string, string>)[row.status] ?? row.status },
    ];

    // Real, direct read — `listVerifications()` resolves a display name but
    // drops the subject id, which this detail page needs for the related
    // record link, previous decisions, Audit and Entity Timeline sections.
    const { data: raw } = await supabase
      .from("verifications")
      .select("user_id, organization_id, subject_type")
      .eq("id", id)
      .maybeSingle();
    if (raw?.subject_type === "user" && raw.user_id) {
      relatedUserId = raw.user_id;
      relatedUserName = row.subjectName;
      const others = rows.filter((r) => r.id !== id && r.subjectType === "user" && r.subjectName === row.subjectName);
      previousDecisions = others.filter((r) => r.decidedAt).map((r) => ({ status: r.status, at: r.decidedAt as string }));
    } else if (raw?.subject_type === "organization" && raw.organization_id) {
      relatedOrgId = raw.organization_id;
      relatedOrgName = row.subjectName;
      const others = rows.filter((r) => r.id !== id && r.subjectType === "organization" && r.subjectName === row.subjectName);
      previousDecisions = others.filter((r) => r.decidedAt).map((r) => ({ status: r.status, at: r.decidedAt as string }));
    }
  } else if (reviewType === "sales-referral") {
    const rows = await listAdminReferrals(supabase, false);
    const row = rows.find((r) => r.id === id);
    if (!row) notFound();
    title = row.displayName ?? "";
    typeLabel = t.typeSalesReferral;
    submittedBy = row.referrerName;
    submittedOn = formatAdminDate(row.createdAt, locale);
    fields = [
      { label: m.admin.orgs.type, value: (m.orgType as Record<string, string>)[row.orgType] ?? row.orgType },
      { label: t.locationLabel, value: [row.governorate, row.city].filter(Boolean).join(" · ") },
    ];
    match = row.matchId ? { name: row.matchName, count: row.matchCount } : null;
    relatedOrgId = row.organizationId;
    relatedOrgName = row.organizationName;
    contactData = row.referrerEmail || null;
  } else {
    const rows = await listAdminNetworkReferrals(supabase, false);
    const row = rows.find((r) => r.id === id);
    if (!row) notFound();
    title = row.displayName ?? "";
    typeLabel = t.typeNetworkReferral;
    submittedBy = row.referrerName;
    submittedOn = formatAdminDate(row.createdAt, locale);
    fields = [
      { label: t.locationLabel, value: [row.governorate, row.city].filter(Boolean).join(" · ") },
      { label: m.admin.networkReferrals.phone, value: row.phone ?? "—" },
    ];
    match = row.matchId ? { name: row.matchName, count: row.matchCount } : null;
    relatedOrgId = row.organizationId;
    relatedOrgName = row.organizationName;
    contactData = row.phone || null;
  }

  const auditEntries = relatedUserId
    ? await previewSubjectAudit(supabase, "user", relatedUserId)
    : relatedOrgId
      ? await previewSubjectAudit(supabase, "organization", relatedOrgId)
      : [];
  const timeline = relatedUserId
    ? await previewUserTimeline(supabase, relatedUserId)
    : relatedOrgId
      ? await previewOrgTimeline(supabase, relatedOrgId)
      : [];
  const notes = previewNotesFor(id);
  const actionLabels = m.admin.actions as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg">
      <Link href="/admin/preview/review" className="text-label text-accent hover:underline">
        ← {m.admin.preview.review.title}
      </Link>

      <div className="flex flex-wrap items-center gap-md">
        <AdminHeader locale={locale} title={title} subtitle={t.detailTitle} />
        <Badge tone="neutral">{typeLabel}</Badge>
      </div>

      <Card className="flex flex-col gap-md">
        <dl className="grid gap-md tablet:grid-cols-3">
          {submittedBy ? <Field label={t.submittedBy}>{submittedBy}</Field> : null}
          <Field label={t.submittedOn}>{submittedOn}</Field>
          {fields.map((f) => (
            <Field key={f.label} label={f.label}>
              {f.value || "—"}
            </Field>
          ))}
        </dl>
      </Card>

      {match ? (
        <div className="flex flex-col gap-sm rounded-sm border border-warning/40 bg-warning/10 px-md py-2.5">
          <p className="text-body font-medium text-fg">{t.possibleDuplicate}</p>
          <p className="text-body text-fg-secondary">
            {t.matches}: {match.name}
            {match.count > 1 ? ` (+${match.count - 1})` : ""}
          </p>
        </div>
      ) : null}

      <Card className="flex flex-col gap-md">
        <dl className="grid gap-md tablet:grid-cols-3">
          <Field label={t.relatedUser}>
            {relatedUserId ? (
              <Link href={`/admin/preview/users/${relatedUserId}`} className="text-accent hover:underline">
                {relatedUserName || m.admin.users.unnamed}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label={t.relatedOrganization}>
            {relatedOrgId ? (
              <Link href={`/admin/preview/organizations/${relatedOrgId}`} className="text-accent hover:underline">
                {relatedOrgName || "—"}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label={t.contactData}>{contactData || "—"}</Field>
        </dl>
      </Card>

      <Card className="flex flex-col gap-sm">
        <SectionTitle>{t.previousDecisions}</SectionTitle>
        {previousDecisions.length === 0 ? (
          <p className="text-body text-fg-secondary">{t.noPreviousDecisions}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {previousDecisions.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-md text-body text-fg-secondary">
                <span>{(m.admin.status as Record<string, string>)[d.status] ?? d.status}</span>
                <span className="text-label text-fg-muted">{formatAdminDate(d.at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap gap-sm">
        <PreviewActionDialog trigger={t.approve} triggerVariant="accent" title={t.approveTitle} body={t.approveBody} confirmLabel={t.approve} confirmVariant="accent" />
        <PreviewActionDialog trigger={t.reject} triggerVariant="danger" title={t.rejectTitle} body={t.rejectBody} confirmLabel={t.reject} confirmVariant="danger">
          <LabeledField label={t.reasonCodeLabel} htmlFor="reject-reason-code">
            <Select id="reject-reason-code" required defaultValue="">
              <option value="" disabled>
                {t.reasonCodePlaceholder}
              </option>
              {PREVIEW_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {reasonCodeLabels[code] ?? code}
                </option>
              ))}
            </Select>
          </LabeledField>
          <LabeledField label={t.internalNoteLabel} htmlFor="reject-internal-note" hint={t.internalNoteHint}>
            <Textarea id="reject-internal-note" rows={2} />
          </LabeledField>
        </PreviewActionDialog>
      </div>

      <div className="grid gap-lg tablet:grid-cols-2">
        <Card className="flex flex-col gap-sm">
          <SectionTitle>{m.admin.preview.notes.title}</SectionTitle>
          <p className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">{m.admin.preview.notes.fixtureNotice}</p>
          {notes.length === 0 ? (
            <StatePanel title={m.admin.preview.notes.empty} />
          ) : (
            <div className="flex flex-col gap-sm">
              {notes.map((n) => (
                <Card key={n.id} pad="sm" className="flex flex-col gap-1">
                  <p className="text-body text-fg">{n.body}</p>
                  <p className="text-label text-fg-muted">
                    {n.author} · {formatDateTime(n.createdAt, locale)} · {m.admin.preview.notes.internalOnly}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-sm">
          <SectionTitle>{m.admin.preview.timeline.title}</SectionTitle>
          {timeline.length === 0 ? (
            <StatePanel title={m.admin.preview.timeline.empty} />
          ) : (
            <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
              {timeline.slice(0, 8).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2 odd:bg-surface-2/30">
                  <span className="font-medium text-fg">{e.label}</span>
                  <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.at, locale)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-sm">
        <SectionTitle>{m.admin.audit.title}</SectionTitle>
        {auditEntries.length === 0 ? (
          <StatePanel title={m.admin.audit.empty} />
        ) : (
          <ol className="flex flex-col gap-px overflow-hidden rounded-md border bg-surface">
            {auditEntries.slice(0, 8).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-md py-2 odd:bg-surface-2/30">
                {e.actorRole ? <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-label text-fg-muted">{e.actorRole}</span> : null}
                <span className="text-fg-secondary">{actionLabels[auditActionKey(e.action)] ?? e.action}</span>
                <span className="ms-auto text-label text-fg-muted">{formatDateTime(e.createdAt, locale)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
