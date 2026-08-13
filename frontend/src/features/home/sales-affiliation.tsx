import { Badge, Card } from "@/components/ui/primitives";
import { BuildingIcon, ClockIcon, PlusIcon, ShieldIcon } from "@/components/ui/icons";
import type { SalesAffiliation } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";
import { ActionCard, ActionGrid, HomeSection } from "./parts";

/**
 * The SALESPERSON's showroom affiliation — the one thing their personal home has
 * that no other persona's does.
 *
 * The Pilot rule this renders: the personal account is usable NOW, and a
 * showroom's Sales tools need an ACTIVE affiliation with that showroom. So this
 * panel reports a *connection*, never an account state, and its copy never implies
 * the account is waiting on anything.
 *
 * Four states are kept strictly separate here and are never combined into one
 * percentage or one badge:
 *   * profile completeness  — the account strip, further down the page
 *   * personal verification — the account strip, further down the page
 *   * showroom affiliation  — this panel
 *   * showroom verification — the showroom's own trust state, shown per showroom
 *
 * `active` is the only signal that means access. An approved request is evidence
 * that access was granted; the ACTIVE membership is the fact, which is why a
 * showroom whose membership was later suspended disappears from `active` while its
 * historical request still reads "approved".
 */
export function SalesAffiliationPanel({
  sales,
  t,
}: {
  sales: SalesAffiliation;
  t: TranslateFn;
}) {
  const pendingRequest = sales.requests.find((r) => r.status === "pending");
  const rejectedRequest = sales.requests.find((r) => r.status === "rejected");
  const openReferral = sales.referrals.find((f) => f.status === "submitted");
  const draftReferral = sales.referrals.find((f) => f.status === "draft");
  const rejectedReferral = sales.referrals.find((f) => f.status === "rejected");

  // Connected: show the showrooms they can work in, and the way into each.
  if (sales.active.length > 0) {
    return (
      <HomeSection
        title={t("personalHome.sales.connected")}
        description={t("personalHome.sales.connectedBody")}
      >
        <ActionGrid>
          {sales.active.map((s) => (
            <ActionCard
              key={s.organizationId}
              href="/b2b"
              icon={<BuildingIcon size={20} />}
              label={s.name}
              body={t("personalHome.sales.openWorkspace")}
              emphasis
            />
          ))}
          <ActionCard
            href="/home/showroom"
            icon={<PlusIcon size={20} />}
            label={t("personalHome.sales.connectAnother")}
            body={t("personalHome.sales.connectAnotherBody")}
          />
        </ActionGrid>
      </HomeSection>
    );
  }

  // Waiting on a showroom Owner/Manager.
  if (pendingRequest) {
    return (
      <HomeSection title={t("personalHome.sales.setup")} description={t("personalHome.sales.setupBody")}>
        <Card className="flex flex-col gap-md">
          <div className="flex flex-wrap items-start justify-between gap-md">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-title text-fg">{pendingRequest.organizationName}</p>
              {pendingRequest.branchName ? (
                <p className="text-body text-fg-secondary">{pendingRequest.branchName}</p>
              ) : null}
            </div>
            <Badge tone="info">
              <ClockIcon size={13} />
              {t("personalHome.sales.status.pending")}
            </Badge>
          </div>
          <p className="text-body text-fg-secondary">{t("personalHome.sales.pendingBody")}</p>
          <p className="text-label text-fg-muted">{t("personalHome.sales.stillUsable")}</p>
        </Card>
      </HomeSection>
    );
  }

  // Referred a showroom that is not on Aladdin yet; the platform is reviewing it.
  if (openReferral) {
    return (
      <HomeSection title={t("personalHome.sales.setup")} description={t("personalHome.sales.setupBody")}>
        <Card className="flex flex-col gap-md">
          <div className="flex flex-wrap items-start justify-between gap-md">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-title text-fg">{openReferral.displayName}</p>
              <p className="text-body text-fg-secondary">
                {[
                  openReferral.governorate
                    ? t(`onboarding.consumer.governorates.${openReferral.governorate}`)
                    : null,
                  openReferral.city ? t(`onboarding.consumer.cities.${openReferral.city}`) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Badge tone="info">
              <ShieldIcon size={13} />
              {t("personalHome.sales.status.submitted")}
            </Badge>
          </div>
          <p className="text-body text-fg-secondary">{t("personalHome.sales.submittedBody")}</p>
          <p className="text-label text-fg-muted">{t("personalHome.sales.stillUsable")}</p>
        </Card>
      </HomeSection>
    );
  }

  // Not connected. This is the normal state of a fresh salesperson, and it is an
  // invitation to set Sales up — not a warning, and not a blocked account.
  return (
    <HomeSection title={t("personalHome.sales.setup")} description={t("personalHome.sales.setupBody")}>
      {rejectedRequest ? (
        <Card className="flex flex-col gap-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-lg font-semibold text-fg">{rejectedRequest.organizationName}</p>
            <Badge tone="danger">{t("personalHome.sales.status.rejected")}</Badge>
          </div>
          {rejectedRequest.reason ? (
            <p className="rounded-sm border border-strong bg-surface-2 px-2.5 py-1.5 text-label text-fg">
              <span className="font-medium">{t("personalHome.sales.reason")}: </span>
              {rejectedRequest.reason}
            </p>
          ) : null}
          <p className="text-label text-fg-muted">{t("personalHome.sales.rejectedBody")}</p>
        </Card>
      ) : null}

      {rejectedReferral ? (
        <Card className="flex flex-col gap-sm">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-lg font-semibold text-fg">{rejectedReferral.displayName}</p>
            <Badge tone="danger">{t("personalHome.sales.status.referralRejected")}</Badge>
          </div>
          {rejectedReferral.reason ? (
            <p className="rounded-sm border border-strong bg-surface-2 px-2.5 py-1.5 text-label text-fg">
              <span className="font-medium">{t("personalHome.sales.reason")}: </span>
              {rejectedReferral.reason}
            </p>
          ) : null}
          <p className="text-label text-fg-muted">{t("personalHome.sales.rejectedBody")}</p>
        </Card>
      ) : null}

      <ActionGrid>
        <ActionCard
          href="/home/showroom"
          icon={<BuildingIcon size={20} />}
          label={t("personalHome.sales.connect")}
          body={t("personalHome.sales.connectBody")}
          emphasis
        />
        {draftReferral ? (
          <ActionCard
            href="/home/showroom/refer"
            icon={<PlusIcon size={20} />}
            label={t("personalHome.sales.resumeReferral")}
            body={t("personalHome.sales.resumeReferralBody")}
          />
        ) : null}
      </ActionGrid>
    </HomeSection>
  );
}
