import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator, getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { formatDate } from "@/lib/ui/format";
import { AdminHeader, TableScroll } from "@/features/admin/parts";
import { localizedName } from "@/features/admin-preview/directory-mappers";
import { StatePanel } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/controls";
import { requireAdminRoute } from "@/server/authorization/admin";
import { loadBusinessVerificationQueue } from "@/server/queries/business-verification";
import { BvStatusBadge } from "@/features/business-verification/parts";
import { isBvStatus, type BvStatus } from "@/lib/business-verification/contract";
import type { Database } from "@/types/database.types";

export const dynamic = "force-dynamic";

type OrgType = Database["public"]["Enums"]["organization_type"];
const ORG_TYPES: readonly OrgType[] = ["showroom_dealer", "supplier", "manufacturer", "importer", "contractor_company", "design_office"];
const FILTER_STATUSES: readonly BvStatus[] = ["pending", "under_review", "needs_info", "verified", "rejected"];
const OPEN: BvStatus[] = ["pending", "under_review", "needs_info"];
const PAGE = 25;

/**
 * Business Verification queue. The RPC decides who may see it (organizations.read, organizations.verify or
 * verification.approve) and what is returned; filters are plain GET parameters so a view is linkable.
 */
export default async function AdminBusinessVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; q?: string; page?: string }>;
}) {
  await requireAdminRoute("/admin/business-verification");
  const sp = await searchParams;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const status = isBvStatus(sp.status) && sp.status !== "none" ? sp.status : null;
  const orgType = ORG_TYPES.find((o) => o === sp.type);
  const q = (sp.q ?? "").trim().slice(0, 120);
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const supabase = await getServerSupabase();
  const result = await loadBusinessVerificationQueue(supabase, { status: status ? [status] : OPEN, orgType, search: q, limit: PAGE, offset: page * PAGE });

  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (status) u.set("status", status);
    if (orgType) u.set("type", orgType);
    if (q) u.set("q", q);
    if (p > 0) u.set("page", String(p));
    const s = u.toString();
    return `/admin/business-verification${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-lg" data-testid="admin-business-verification">
      <AdminHeader locale={locale} title={t("businessVerification.admin.title")} subtitle={t("businessVerification.admin.subtitle")} count={result?.total} />

      <form method="get" className="flex flex-wrap items-end gap-sm" role="search">
        <label className="flex flex-col gap-1 text-label text-fg-secondary">
          {t("businessVerification.admin.filters.status")}
          <Select name="status" defaultValue={status ?? ""} aria-label={t("businessVerification.admin.filters.status")}>
            <option value="">{t("businessVerification.admin.filters.allStatuses")}</option>
            {FILTER_STATUSES.map((s) => <option key={s} value={s}>{t(`businessVerification.status.${s}`)}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-label text-fg-secondary">
          {t("businessVerification.admin.filters.orgType")}
          <Select name="type" defaultValue={orgType ?? ""} aria-label={t("businessVerification.admin.filters.orgType")}>
            <option value="">{t("businessVerification.admin.filters.allTypes")}</option>
            {ORG_TYPES.map((o) => <option key={o} value={o}>{m.orgType[o]}</option>)}
          </Select>
        </label>
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-label text-fg-secondary">
          {t("businessVerification.admin.filters.search")}
          <Input type="search" name="q" defaultValue={q} maxLength={120} />
        </label>
        <button type="submit" className="min-h-10 rounded-sm bg-surface-2 px-md text-label font-medium text-fg hover:bg-surface-hover">
          {t("businessVerification.admin.filters.apply")}
        </button>
      </form>

      {!result ? (
        <StatePanel tone="danger" title={t("states.genericRetry")} />
      ) : result.rows.length === 0 ? (
        <StatePanel title={t("businessVerification.admin.empty")} />
      ) : (
        <TableScroll>
          <table className="w-full min-w-[44rem] text-start text-body">
            <thead>
              <tr className="border-b text-label text-fg-muted">
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.business")}</th>
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.status")}</th>
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.submitted")}</th>
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.rounds")}</th>
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.documents")}</th>
                <th className="px-md py-2 text-start font-medium">{t("businessVerification.admin.columns.reviewer")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0" data-testid="bv-queue-row">
                  <td className="px-md py-2.5">
                    <Link href={`/admin/business-verification/${r.id}`} className="font-medium text-accent hover:underline">
                      {localizedName({ name: r.name, nameAr: r.nameAr, nameEn: r.nameEn }, locale)}
                    </Link>
                    <p className="text-label text-fg-muted">{m.orgType[r.orgType] ?? r.orgType}</p>
                  </td>
                  <td className="px-md py-2.5"><BvStatusBadge status={r.status} t={t} /></td>
                  <td className="px-md py-2.5 text-fg-secondary">{formatDate(r.lastSubmittedAt ?? r.submittedAt, locale)}</td>
                  <td className="px-md py-2.5 text-fg-secondary">{r.rounds}</td>
                  <td className="px-md py-2.5 text-fg-secondary">{r.documents}</td>
                  <td className="px-md py-2.5 text-fg-secondary">{r.reviewerName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {result && result.total > PAGE ? (
        <nav className="flex items-center justify-between gap-md text-label" aria-label={t("businessVerification.admin.title")}>
          {page > 0 ? <Link href={qs(page - 1)} className="text-accent hover:underline">{t("businessVerification.admin.previousPage")}</Link> : <span />}
          <span className="text-fg-muted">{page * PAGE + 1}–{Math.min(result.total, (page + 1) * PAGE)} / {result.total}</span>
          {(page + 1) * PAGE < result.total ? <Link href={qs(page + 1)} className="text-accent hover:underline">{t("businessVerification.admin.nextPage")}</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
