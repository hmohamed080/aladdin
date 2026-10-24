import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator, getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { can } from "@/lib/permissions/admin";
import { UUID_SHAPE } from "@/lib/business-verification/contract";
import { AdminHeader, StatusBadge } from "@/features/admin/parts";
import { localizedName } from "@/features/admin-preview/directory-mappers";
import { Card, Field, SectionTitle } from "@/components/ui/primitives";
import { BuildingIcon, FileTextIcon, ScrollIcon } from "@/components/ui/icons";
import { requireAdminRoute } from "@/server/authorization/admin";
import { loadBusinessVerificationDetail } from "@/server/queries/business-verification";
import { loadNotes } from "@/server/queries/admin-operations";
import { NotesPanel } from "@/features/admin-ops/panels";
import { BvStatusBadge, BvSubmissionList } from "@/features/business-verification/parts";
import { BvAdminActions } from "@/features/business-verification/admin-actions";

export const dynamic = "force-dynamic";

/**
 * One business verification request: the business, every submission round with its documents, earlier
 * requests, and the review controls. `business_verification_detail` answers only a reviewer
 * (organizations.verify or verification.approve); anyone else gets the same not-found.
 */
export default async function AdminBusinessVerificationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminRoute("/admin/business-verification");
  const { id } = await params;
  if (!UUID_SHAPE.test(id)) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const supabase = await getServerSupabase();
  const d = await loadBusinessVerificationDetail(supabase, id);
  if (!d) notFound();
  const org = d.organization;
  const notes = can(access, "notes.read") ? await loadNotes(supabase, "organization", org.id) : null;
  const statusLabels = m.admin.status as Record<string, string>;

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-business-verification-detail">
      <Link href="/admin/business-verification" className="text-label text-accent hover:underline">
        ← {t("businessVerification.admin.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-wrap items-center gap-md">
          <AdminHeader locale={locale} title={localizedName(org, locale)} subtitle={m.orgType[org.orgType] ?? org.orgType} />
          <BvStatusBadge status={d.status} t={t} />
        </div>
        <BvAdminActions id={d.id} status={d.status} canReview={d.canReview} canDecide={d.canDecide} />
      </div>

      {d.isOwnOrganization ? (
        <p role="note" className="rounded-sm border border-warning/40 bg-warning/10 px-3 py-2.5 text-body text-fg">{t("businessVerification.admin.ownOrganization")}</p>
      ) : !d.canDecide && (d.status === "pending" || d.status === "under_review") ? (
        <p role="note" className="rounded-sm border border-info/40 bg-info/10 px-3 py-2.5 text-body text-fg">{t("businessVerification.admin.noDecideAuthority")}</p>
      ) : null}

      <div className="grid gap-lg desktop:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-lg">
          <Card>
            <SectionTitle icon={<FileTextIcon size={18} />}>{t("businessVerification.admin.evidenceTitle")}</SectionTitle>
            <div className="mt-md">
              {d.submissions.length === 0 ? <p className="text-body text-fg-muted">—</p> : <BvSubmissionList submissions={d.submissions} t={t} locale={locale} />}
            </div>
            {d.reason ? (
              <div className="mt-md border-t pt-sm">
                <p className="text-label font-medium text-fg-secondary">{t("businessVerification.admin.currentReason")}</p>
                <p className="mt-1 whitespace-pre-line text-body text-fg" dir="auto">{d.reason}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <SectionTitle icon={<ScrollIcon size={18} />}>{t("businessVerification.admin.previousTitle")}</SectionTitle>
            {d.previous.length === 0 ? (
              <p className="mt-md text-body text-fg-muted">{t("businessVerification.admin.noPrevious")}</p>
            ) : (
              <ol className="mt-md flex flex-col gap-sm">
                {d.previous.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1 rounded-sm bg-surface-2/50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/business-verification/${p.id}`} className="text-label font-medium text-accent hover:underline">
                        {t("businessVerification.submittedOn", { date: formatDate(p.submittedAt, locale) })}
                      </Link>
                      <BvStatusBadge status={p.status} t={t} />
                    </div>
                    {p.reason ? <p className="whitespace-pre-line text-label text-fg-secondary" dir="auto">{p.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <NotesPanel m={m} locale={locale} subjectType="organization" subjectId={org.id} notes={notes} canCreate={can(access, "notes.create")} />
        </div>

        <Card className="h-fit">
          <SectionTitle icon={<BuildingIcon size={18} />}>{t("businessVerification.admin.organizationTitle")}</SectionTitle>
          <dl className="mt-md flex flex-col gap-md">
            <Field label={t("businessVerification.admin.columns.business")}>
              <Link href={`/admin/organizations/${org.id}`} className="text-accent hover:underline">{localizedName(org, locale)}</Link>
            </Field>
            {org.legalName ? <Field label={t("businessVerification.admin.legalName")}><span dir="auto">{org.legalName}</span></Field> : null}
            <Field label={t("businessVerification.admin.orgStatus")}>
              <StatusBadge status={org.status} label={statusLabels[org.status] ?? org.status} />
            </Field>
            <Field label={t("businessVerification.admin.application")}>
              {d.application?.status === "approved"
                ? t("businessVerification.admin.applicationApproved", { date: formatDate(d.application.decidedAt, locale) })
                : d.application
                  ? statusLabels[d.application.status] ?? d.application.status
                  : t("businessVerification.admin.applicationNone")}
            </Field>
            {org.owner ? (
              <Field label={t("businessVerification.admin.owner")}>
                <Link href={`/admin/users/${org.owner.id}`} className="text-accent hover:underline">{org.owner.displayName || m.admin.users.unnamed}</Link>
              </Field>
            ) : null}
            {org.contactPhone || org.contactEmail ? (
              <Field label={t("businessVerification.admin.contact")}>
                <span className="flex flex-col" dir="ltr">
                  {org.contactPhone ? <span>{org.contactPhone}</span> : null}
                  {org.contactEmail ? <span>{org.contactEmail}</span> : null}
                </span>
              </Field>
            ) : null}
            <Field label={t("businessVerification.admin.reviewer")}>{d.reviewerName ?? "—"}</Field>
            <Field label={t("businessVerification.admin.columns.submitted")}>{formatDate(d.submittedAt, locale)}</Field>
          </dl>
        </Card>
      </div>
    </div>
  );
}
