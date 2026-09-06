import type { ReactNode } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/controls";
import {
  UserIcon,
  GlobeIcon,
  SettingsIcon,
  HelpIcon,
  GaugeIcon,
  StarIcon,
  ClipboardIcon,
} from "@/components/ui/icons";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { ProfilePublication } from "@/server/queries/professional-profile";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { AvailabilityBadge } from "@/features/profile/availability-status";
import { HomeHeader, HomeSection, VerificationBadge } from "@/features/home/parts";
import type { ProfessionalAssetSummary } from "@/server/queries/portfolio";
import { CertificatesModule, PortfolioModule } from "@/features/portfolio/hub-modules";
import { ReviewsModule } from "@/features/reviews/hub-module";
import { NetworkModule } from "@/features/network/hub-module";
import { WorkModule } from "@/features/work/hub-module";
import { PointsModule } from "@/features/points/hub-module";
import type { RatingSummary } from "@/lib/reviews/summary";
import type { NetworkOrganization } from "@/server/queries/network";
import { formatNumber } from "@/lib/ui/format";

/**
 * The Account Overview (revisit, Increment 14, reference 04) — a real
 * account DASHBOARD, not a vertically-expanded profile editor.
 *
 * WHAT THIS PAGE IS FOR, AND WHAT IT IS NOT. It answers "what does my
 * account actually say, at a glance" — identity, a real summary strip, and a
 * grid of every real module (Work, Portfolio, Certificates, Reviews, Points,
 * Network). It is deliberately NOT the place the full professional-profile
 * detail (trades, lead time, languages, service area, core services, bio)
 * or the live availability toggle live — those already have owners
 * (`/home/profile/edit` and `/home/settings`), and reproducing their full
 * content here a second time is what turned the previous pass into a
 * 2000px+ scroll mixing two different products. This page links to those
 * destinations instead of restating them.
 *
 * STILL NOTHING FABRICATED. No completion percentage, no verification
 * score, no invented rating, no fake count — the strip and every module
 * render only what its own query returned; see each module's own comment
 * for its specific zero-state (never a `0.0` or a `0` presented as though it
 * were a meaningful reading).
 */
export function ProfileHub({
  data,
  publication,
  assets,
  reviews,
  network,
  pointsBalance,
  completedJobsCount,
  locale,
  t,
}: {
  data: PersonalHomeData;
  publication: ProfilePublication;
  /** Real Portfolio and Certificate counts (Increment 11). */
  assets: ProfessionalAssetSummary;
  /** The caller's real rating, from the same rows /home/reviews lists. */
  reviews: RatingSummary;
  /** The caller's real network, from the same rows /home/network lists. */
  network: readonly NetworkOrganization[];
  /** The same balance /home/points reads. */
  pointsBalance: number;
  /** Completed assignments — the same count /home/work's summary derives. */
  completedJobsCount: number;
  locale: Locale;
  t: TranslateFn;
}) {
  const { professional: p, verification } = data;
  const persona = t(`accountType.${data.accountType}`);
  const name = data.displayName || t("personalHome.professional.friend");

  const tiles: Tile[] = [
    { label: t("profile.snapshot.reviews"), value: reviews.total, Icon: StarIcon, tone: "warning", href: "/home/reviews" },
    {
      label: t("profile.snapshot.rating"),
      value: reviews.average === null ? "—" : formatNumber(reviews.average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      Icon: StarIcon,
      tone: "warning",
      href: "/home/reviews",
    },
    { label: t("profile.snapshot.completedJobs"), value: completedJobsCount, Icon: ClipboardIcon, tone: "success", href: "/home/work" },
    { label: t("profile.snapshot.points"), value: pointsBalance, Icon: GaugeIcon, tone: "accent", href: "/home/points" },
  ];

  return (
    <div className="flex flex-col gap-xl" data-testid="profile-hub">
      <HomeHeader
        eyebrow={persona}
        title={name}
        name={data.displayName}
        lead={p.headline ?? t("personalHome.professional.noHeadline")}
        meta={
          <>
            <VerificationBadge state={verification.state} t={t} />
            <AvailabilityBadge available={data.availability.available} t={t} />
            <ButtonLink href="/home/profile/edit" variant="outline" size="sm">
              {t("profile.hub.edit")}
            </ButtonLink>
          </>
        }
      />

      <StatTiles tiles={tiles} locale={locale} layout="strip" columns={4} />

      <HomeSection title={t("profile.work.title")} description={t("profile.work.body")}>
        <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-3">
          <WorkModule completedCount={completedJobsCount} t={t} />
          <PortfolioModule summary={assets} publicItemId={assets.previewItemId} t={t} />
          <CertificatesModule summary={assets} t={t} />
          <ReviewsModule summary={reviews} t={t} />
          <PointsModule balance={pointsBalance} locale={locale} t={t} />
          <NetworkModule organizations={network} t={t} />
        </div>
      </HomeSection>

      {/* THE ACCOUNT ACTION AREA — three real destinations, never their full
          content restated here. Trades, lead time, languages, service area,
          core services and bio all belong to `/home/profile/edit`; the live
          availability toggle belongs to `/home/settings` (the identity
          header above already carries the read-only badge for it); and the
          public profile is a real link when listed, a real state when not —
          never the two-paragraph explainer a prior pass duplicated here. */}
      <HomeSection title={t("profile.accountArea.title")}>
        <div className="flex flex-col divide-y rounded-md border bg-surface shadow-card">
          <AccountActionRow
            icon={<SettingsIcon size={20} />}
            title={t("personalNav.settings")}
            body={t("profile.accountArea.settingsBody")}
          >
            <Link href="/home/settings">
              <Button type="button" variant="outline">
                {t("personalNav.settings")}
              </Button>
            </Link>
          </AccountActionRow>

          <AccountActionRow
            icon={<GlobeIcon size={20} />}
            title={t("profile.public.title")}
            body={publication.listed ? t("profile.public.listedTitle") : t("profile.public.hiddenTitle")}
          >
            {publication.listed && publication.profileId ? (
              <Link href={`/p/${publication.profileId}`}>
                <Button type="button" variant="outline">
                  <span className="flex items-center gap-2">
                    <UserIcon size={16} />
                    {t("profile.public.view")}
                  </span>
                </Button>
              </Link>
            ) : null}
          </AccountActionRow>

          <AccountActionRow icon={<HelpIcon size={20} />} title={t("profile.accountArea.support")}>
            <Link href="/auth/support">
              <Button type="button" variant="ghost">
                {t("profile.accountArea.support")}
              </Button>
            </Link>
          </AccountActionRow>
        </div>
      </HomeSection>
    </div>
  );
}

/** One row of the account action area: an icon, a real destination's name and state, and its action. */
function AccountActionRow({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-md p-md">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="shrink-0 text-fg-secondary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-medium text-fg">{title}</p>
          {body ? <p className="text-label text-fg-secondary">{body}</p> : null}
        </div>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}
