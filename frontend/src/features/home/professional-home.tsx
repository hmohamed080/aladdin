import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/controls";
import { StatePanel } from "@/components/ui/primitives";
import { Panel, WorkPane } from "@/components/ui/workspace-layout";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import {
  BadgeCheckIcon,
  BriefcaseIcon,
  BuildingIcon,
  GaugeIcon,
  StarIcon,
  UsersIcon,
  UserIcon,
  ClipboardIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";
import { AccountStrip, HomeHeader, VerificationBadge } from "./parts";
import { SalesAffiliationPanel } from "./sales-affiliation";
import { AvailabilityBadge } from "@/features/profile/availability-status";
import type { CompletenessItemKey } from "@/lib/profile/completeness";
import type { Locale } from "@/lib/i18n/locales";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import { CurrentWorkBlock } from "./current-work-block";
import { OpportunityCard } from "@/features/jobs/opportunity-list";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import { formatNumber } from "@/lib/ui/format";

/**
 * The PROFESSIONAL variant of the personal surface — an operational dashboard,
 * not a profile summary (revisit, Increment 14, reference 01).
 *
 * WHY THIS STOPPED BEING A PROFILE PAGE. Every earlier pass of this page led
 * with identity and practice detail, because that was the only real content
 * Increments 1–7 had produced. By Increment 13 that is no longer true: there
 * is real current work, real open opportunities, a real Points balance, real
 * reviews and a real network. Home's job now is to say "here is where things
 * stand right now", and the professional's own practice detail (specialty,
 * service area, bio, languages) moved to `/home/profile` — the Account
 * Overview — which is where a reader goes to review or change it, not to
 * glance at it once a day.
 *
 * THE SUMMARY STRIP IS FOUR REAL NUMBERS, NOTHING MORE. Points balance,
 * average rating, network size and completed-assignment count — the same
 * figures `/home/points`, `/home/reviews`, `/home/network` and `/home/work`
 * already show, read here from the SAME query functions so the strip cannot
 * disagree with the pages it links to. No fake appointments, earnings,
 * messages or activity feed — none of those have authority anywhere in this
 * product.
 *
 * OPPORTUNITIES IS A REAL PREVIEW, NOT A COUNT. The earlier "no opportunity
 * count" decision was about a NUMBER on a nav-adjacent action card, made
 * before this composition pass existed to hold a real list. A handful of
 * actual open jobs, capped at the query layer (`listJobOpportunities`'s own
 * `limit`), costs one bounded read and is exactly what the reference shows.
 */

const STEP_FOR_ITEM: Record<CompletenessItemKey, string> = {
  displayName: "/onboarding/profile",
  phone: "/onboarding/contact",
  intent: "/onboarding/consumer",
  interests: "/onboarding/consumer",
  budget: "/onboarding/consumer",
  professionalType: "/home/profile/edit",
  headline: "/home/profile/edit",
  experience: "/home/profile/edit",
  specialization: "/home/profile/edit",
  services: "/home/profile/edit",
  bio: "/home/profile/edit",
  languages: "/home/profile/edit",
  availability: "/home/profile/edit",
  serviceArea: "/home/profile/edit",
  location: "/home/profile/edit",
  travelRadius: "/home/profile/edit",
};

export function ProfessionalHome({
  data,
  currentWork,
  opportunities,
  pointsBalance,
  reviewsAverage,
  reviewsTotal,
  networkCount,
  completedJobsCount,
  locale,
  t,
}: {
  data: PersonalHomeData;
  /** The one live assignment to lead with, or null (§21). */
  currentWork: MyAssignmentRow | null;
  /** A REAL, bounded preview — never the full board. */
  opportunities: readonly OpportunityRow[];
  pointsBalance: number;
  reviewsAverage: number | null;
  reviewsTotal: number;
  networkCount: number;
  completedJobsCount: number;
  locale: Locale;
  t: TranslateFn;
}) {
  const { completeness, verification } = data;
  const name = data.displayName || t("personalHome.professional.friend");
  const persona = t(`accountType.${data.accountType}`);
  const nextStep = completeness.missing[0] ? STEP_FOR_ITEM[completeness.missing[0]] : "/home/profile/edit";
  const needsVerificationAttention = verification.state === "rejected" || verification.state === "needs_more_info";

  const tiles: Tile[] = [
    { label: t("personalHome.snapshot.points"), value: pointsBalance, Icon: GaugeIcon, tone: "accent", href: "/home/points" },
    {
      label: t("personalHome.snapshot.rating"),
      value: reviewsAverage === null ? "—" : formatNumber(reviewsAverage, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      hint: t("personalHome.snapshot.ratingHint", { n: reviewsTotal }),
      Icon: StarIcon,
      tone: "warning",
      href: "/home/reviews",
    },
    { label: t("personalHome.snapshot.network"), value: networkCount, Icon: UsersIcon, tone: "info", href: "/home/network" },
    { label: t("personalHome.snapshot.completedJobs"), value: completedJobsCount, Icon: ClipboardIcon, tone: "success", href: "/home/work" },
  ];

  return (
    <div className="flex flex-col gap-md" data-testid="professional-home">
      <HomeHeader
        eyebrow={persona}
        title={t("personalHome.greeting", { name })}
        name={data.displayName}
        lead={data.professional.headline ?? t("personalHome.professional.noHeadline")}
        meta={
          <>
            <VerificationBadge state={verification.state} t={t} />
            {/* The STATE only — the control and the "last updated" line live on
                the Account Overview. */}
            <AvailabilityBadge available={data.availability.available} t={t} />
          </>
        }
      />

      {/* A salesperson's Sales setup is the first thing that matters to them, so it
          leads — as a connection to make, never as an account problem. */}
      {data.sales ? <SalesAffiliationPanel sales={data.sales} t={t} /> : null}

      <StatTiles tiles={tiles} locale={locale} layout="strip" columns={4} />

      <WorkPane
        asideWidth="wide"
        aside={
          <>
            <Panel title={t("personalHome.quickAccess.title")} Icon={SettingsIcon} bodyClassName="p-0">
              <ul className="flex flex-col divide-y">
                <QuickLink href="/home/profile/edit" Icon={UserIcon} label={t("personalHome.professional.action.editProfile")} />
                {needsVerificationAttention ? (
                  <QuickLink
                    href="/onboarding/professional/review"
                    Icon={BadgeCheckIcon}
                    label={t("personalHome.professional.action.review")}
                  />
                ) : null}
                <QuickLink href="/home/settings" Icon={SettingsIcon} label={t("personalNav.settings")} />
                <QuickLink href="/business/new" Icon={BuildingIcon} label={t("personalHome.action.addBusiness")} />
              </ul>
            </Panel>

            <AccountStrip completeness={completeness} verification={verification} continueHref={nextStep} t={t} />
          </>
        }
      >
        <HomeSectionCard title={t("work.home.title")} action={currentWork ? { href: "/home/work", label: t("work.home.view") } : undefined}>
          <CurrentWorkBlock assignment={currentWork} locale={locale} />
        </HomeSectionCard>

        <Panel
          title={t("jobs.opportunities.title")}
          Icon={BriefcaseIcon}
          action={
            <ButtonLink href="/home/jobs" variant="outline" size="sm">
              {t("jobs.opportunities.viewAll")}
            </ButtonLink>
          }
        >
          {opportunities.length === 0 ? (
            <StatePanel icon={<BriefcaseIcon size={20} />} title={t("jobs.opportunities.emptyTitle")} body={t("jobs.opportunities.emptyBody")} />
          ) : (
            <ul className="grid gap-sm tablet:grid-cols-2 desktop:grid-cols-3">
              {opportunities.map((o) => (
                <li key={o.id}>
                  <OpportunityCard opportunity={o} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </WorkPane>
    </div>
  );
}

/** A thin wrapper so "Current work" reads as a Panel-weight section without a
 *  second Card nested inside `CurrentWorkBlock`'s own. */
function HomeSectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between gap-sm">
        <h2 className="text-title text-fg">{title}</h2>
        {action ? (
          <ButtonLink href={action.href} variant="outline" size="sm">
            {action.label}
          </ButtonLink>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function QuickLink({
  href,
  Icon,
  label,
}: {
  href: string;
  Icon: ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2.5 px-md py-2.5 text-body text-fg-secondary transition-colors hover:bg-surface-2/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
      >
        <span className="shrink-0 text-fg-muted" aria-hidden="true">
          <Icon size={17} />
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </Link>
    </li>
  );
}
