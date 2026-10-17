import { createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatDate } from "@/lib/ui/format";
import { Card, SectionTitle, StatePanel } from "@/components/ui/primitives";
import { AlertIcon, BadgeCheckIcon, ClockIcon, FileTextIcon, ScrollIcon } from "@/components/ui/icons";
import { loadMyBusinessVerification } from "@/server/queries/business-verification";
import type { requireShowroomContext } from "@/features/showroom-shell/context";
import { BvOwnerPanel } from "./owner-panel";
import { BvStatusBadge, BvSubmissionList } from "./parts";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

/**
 * The owner's Business Verification page. Approval of the application (the organization is active) and the
 * Verified badge are two different things: this page asks for the badge. Everything shown comes from
 * `my_business_verification`, which only answers an org.manage holder of this organization.
 */
export async function ShowroomVerification({ ctx, locale }: { ctx: Ctx; locale: Locale }) {
  const t = createTranslator(locale);
  const view = await loadMyBusinessVerification(ctx.supabase, ctx.org.organizationId);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" data-testid="showroom-verification">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-headline text-fg">{t("businessVerification.owner.title")}</h1>
        <p className="text-body text-fg-secondary">{t("businessVerification.owner.subtitle")}</p>
      </div>

      {!view ? (
        <StatePanel tone="danger" icon={<AlertIcon size={20} />} title={t("states.genericRetry")} />
      ) : (
        <>
          <Card>
            <SectionTitle icon={<BadgeCheckIcon size={18} />} action={<BvStatusBadge status={view.status} t={t} />}>
              {t("businessVerification.owner.statusTitle")}
            </SectionTitle>
            <div className="mt-md flex flex-col gap-sm" data-testid="bv-status" data-status={view.status}>
              <p className="text-body text-fg-secondary">
                {view.status === "verified" && view.legacyVerified
                  ? t("businessVerification.owner.body.legacy")
                  : t(`businessVerification.owner.body.${view.status}`)}
              </p>
              {view.status === "verified" && view.verifiedAt ? (
                <p className="text-label text-fg-muted">{t("businessVerification.owner.verifiedOn", { date: formatDate(view.verifiedAt, locale) })}</p>
              ) : null}
              {view.reason && (view.status === "needs_info" || view.status === "rejected") ? (
                <div className="rounded-sm border border-warning/40 bg-warning/10 px-3 py-2.5" role="note">
                  <p className="text-label font-medium text-fg">
                    {view.status === "needs_info" ? t("businessVerification.owner.requestedInfo") : t("businessVerification.owner.rejectionReason")}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-body text-fg" dir="auto">{view.reason}</p>
                </div>
              ) : null}
              {view.organizationStatus !== "active" ? (
                <p className="text-label text-fg-muted">{t("businessVerification.owner.awaitingApproval")}</p>
              ) : null}
            </div>
          </Card>

          {view.canUpload || view.canSubmit ? (
            <Card>
              <SectionTitle icon={<FileTextIcon size={18} />}>{t("businessVerification.owner.documentsTitle")}</SectionTitle>
              <p className="mt-sm text-body text-fg-secondary">{t("businessVerification.owner.documentsBody")}</p>
              <div className="mt-md">
                <BvOwnerPanel
                  orgId={ctx.org.organizationId}
                  drafts={view.drafts}
                  canUpload={view.canUpload}
                  canSubmit={view.canSubmit}
                  isResubmission={view.isResubmission}
                />
              </div>
            </Card>
          ) : view.status === "pending" || view.status === "under_review" ? (
            <StatePanel icon={<ClockIcon size={20} />} title={t("businessVerification.owner.inReviewTitle")} body={t("businessVerification.owner.inReviewBody")} />
          ) : null}

          {view.requests.length > 0 ? (
            <Card>
              <SectionTitle icon={<ScrollIcon size={18} />}>{t("businessVerification.owner.historyTitle")}</SectionTitle>
              <ol className="mt-md flex flex-col gap-lg" data-testid="bv-history">
                {view.requests.map((r) => (
                  <li key={r.id} className="flex flex-col gap-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <BvStatusBadge status={r.status} t={t} />
                      <span className="text-label text-fg-muted">
                        {t("businessVerification.submittedOn", { date: formatDate(r.submittedAt, locale) })}
                        {r.decidedAt ? ` · ${t("businessVerification.decidedOn", { date: formatDate(r.decidedAt, locale) })}` : ""}
                      </span>
                    </div>
                    {r.reason && r.status !== "pending" && r.status !== "under_review" ? (
                      <p className="whitespace-pre-line text-body text-fg-secondary" dir="auto">{r.reason}</p>
                    ) : null}
                    <BvSubmissionList submissions={r.submissions} t={t} locale={locale} />
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
