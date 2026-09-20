import Image from "next/image";
import Link from "next/link";
import { BadgeCheckIcon, BriefcaseIcon, ClipboardIcon, FactoryIcon, GiftIcon, StarIcon, VideoIcon } from "@/components/ui/icons";
import { ProgressMeter } from "@/components/ui/primitives";
import { tradeLabel } from "@/lib/i18n/trade-label";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { formatMoney, formatNumber, formatRelativeTime } from "@/lib/ui/format";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import type { NetworkOrganization } from "@/server/queries/network";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import { CurrentWorkBlock } from "./current-work-block";
import { ModuleCard, ModuleFooterLink } from "@/features/installer-dashboard-preview/module-card";

type Props = {
  data: PersonalHomeData;
  currentWork: MyAssignmentRow | null;
  opportunities: readonly OpportunityRow[];
  pointsBalance: number;
  reviewsAverage: number | null;
  reviewsTotal: number;
  network: readonly NetworkOrganization[];
  networkCount: number;
  completedJobsCount: number;
  locale: Locale;
  t: TranslateFn;
};

const JOB_IMAGES = [
  "/assets/installer-dashboard/jobs/spc-flooring.jpg",
  "/assets/installer-dashboard/jobs/ac-install.jpg",
  "/assets/installer-dashboard/jobs/marble-alt.jpg",
] as const;

/**
 * The approved installer composition, backed only by caller-scoped production
 * reads. Decorative photography is deliberately not presented as job media:
 * the Jobs schema has no image column, so every card labels it as a visual
 * category treatment and the record facts remain the sole source of truth.
 */
export function InstallerHome(props: Props) {
  const { data, opportunities, pointsBalance, locale, t } = props;
  const firstName = (data.displayName || t("personalHome.professional.friend")).split(" ")[0];

  return (
    <div className="flex flex-col gap-5" data-testid="installer-home">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-headline text-fg">
            {locale === "ar" ? `أهلاً ${firstName} 👋` : `Hi ${firstName} 👋`}
          </h1>
          <p className="mt-1 text-body-lg text-fg-secondary">
            {locale === "ar" ? "يوم موفق في شغلك" : "Have a productive day"}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-body text-fg-secondary">
            <span className="h-2 w-2 rounded-pill bg-success" aria-hidden="true" />
            {opportunities.length > 0
              ? locale === "ar"
                ? `${formatNumber(opportunities.length, locale)} فرص شغل مفتوحة الآن`
                : `${formatNumber(opportunities.length, locale)} open opportunities now`
              : locale === "ar"
                ? "لا توجد فرص مفتوحة الآن"
                : "No open opportunities right now"}
          </p>
        </div>

        <Link
          href="/home/points"
          className="flex items-center gap-3 rounded-lg border border-accent-solid/25 bg-gradient-to-br from-accent-solid/20 via-accent-solid/10 to-transparent px-4 py-3 shadow-card transition-colors hover:from-accent-solid/30"
        >
          <Image src="/assets/installer-dashboard/rewards/trophy.png" alt="" width={112} height={112} className="h-24 w-24 object-contain" />
          <span className="flex flex-col">
            <span className="font-mono text-title font-semibold text-fg">
              {formatNumber(pointsBalance, locale)} {locale === "ar" ? "نقطة" : "pts"}
            </span>
            <span className="text-label font-medium text-accent">
              {locale === "ar" ? "عرض نقاطي" : "View my points"}
            </span>
          </span>
        </Link>
      </div>

      <ProfileCompletion data={data} locale={locale} />
      <QuickAccess data={data} locale={locale} />
      <Opportunities opportunities={opportunities} locale={locale} t={t} />

      <div className="grid items-stretch gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
        <WorkModule assignment={props.currentWork} locale={locale} />
        <NetworkModule network={props.network} count={props.networkCount} locale={locale} />
        <LearningModule locale={locale} />
        <ReputationModule
          points={pointsBalance}
          average={props.reviewsAverage}
          reviewCount={props.reviewsTotal}
          completedJobs={props.completedJobsCount}
          locale={locale}
        />
      </div>
    </div>
  );
}

function QuickAccess({ data, locale }: { data: PersonalHomeData; locale: Locale }) {
  const verificationNeedsWork = data.verification.state === "rejected" || data.verification.state === "needs_more_info";
  return (
    <nav aria-label={locale === "ar" ? "وصول سريع" : "Quick access"} className="flex flex-wrap gap-2">
      <Link href="/home/profile/edit" className="rounded-pill border bg-surface px-3 py-1.5 text-label font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg">{locale === "ar" ? "تعديل الملف" : "Edit profile"}</Link>
      {verificationNeedsWork ? <Link href="/onboarding/professional/review" className="rounded-pill border border-warning/40 bg-warning/10 px-3 py-1.5 text-label font-medium text-warning">{locale === "ar" ? "مراجعة التوثيق" : "Review verification"}</Link> : null}
      <Link href="/home/settings" className="rounded-pill border bg-surface px-3 py-1.5 text-label font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg">{locale === "ar" ? "الإعدادات" : "Settings"}</Link>
      <Link href="/business/new" className="rounded-pill border bg-surface px-3 py-1.5 text-label font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg">{locale === "ar" ? "إضافة نشاط" : "Add a business"}</Link>
    </nav>
  );
}

function ProfileCompletion({ data, locale }: { data: PersonalHomeData; locale: Locale }) {
  if (data.completeness.percent >= 100) return null;
  const verified = data.verification.state === "verified";
  return (
    <div id="profile" className="rounded-lg border border-iris-solid/20 bg-surface p-4 shadow-card tablet:p-5">
      <div className="flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-body-lg font-semibold text-fg">
            {locale === "ar" ? "أكمل ملفك الشخصي لزيادة ظهورك" : "Complete your profile to improve your visibility"}
          </p>
          <div className="mt-3 flex max-w-sm items-center gap-2.5">
            <div className="flex-1">
              <ProgressMeter value={data.completeness.percent} tone="accent" size="sm" label={locale === "ar" ? "اكتمال الملف الشخصي" : "Profile completion"} />
            </div>
            <span className="font-mono text-label font-semibold text-fg">{formatNumber(data.completeness.percent, locale)}%</span>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-caption text-fg-secondary">
            <BadgeCheckIcon size={14} className={verified ? "text-success" : "text-fg-muted"} />
            {verified ? (locale === "ar" ? "حساب موثّق" : "Verified account") : (locale === "ar" ? "التوثيق منفصل عن اكتمال الملف" : "Verification is separate from profile completion")}
          </p>
        </div>
        <Link href="/home/profile/edit" className="self-start rounded-sm bg-iris-solid px-4 py-2 text-label font-semibold text-white hover:brightness-105 tablet:self-center">
          {locale === "ar" ? "استكمال الملف" : "Complete profile"}
        </Link>
      </div>
    </div>
  );
}

function Opportunities({ opportunities, locale, t }: { opportunities: readonly OpportunityRow[]; locale: Locale; t: TranslateFn }) {
  return (
    <section id="opportunities" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-sm bg-iris-solid/10 text-iris"><BriefcaseIcon size={17} /></span>
          <h2 className="text-headline text-fg">{locale === "ar" ? "فرص الشغل المتاحة" : "Available job opportunities"}</h2>
        </div>
        <Link href="/home/jobs" className="text-label font-medium text-iris hover:underline">{locale === "ar" ? "عرض الكل" : "View all"}</Link>
      </div>
      {opportunities.length === 0 ? (
        <div className="rounded-lg border bg-surface p-6 text-center shadow-card">
          <p className="text-title text-fg">{t("jobs.opportunities.emptyTitle")}</p>
          <p className="mt-1 text-body text-fg-secondary">{t("jobs.opportunities.emptyBody")}</p>
        </div>
      ) : (
        <ul className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {opportunities.map((job, index) => <Opportunity key={job.id} job={job} image={JOB_IMAGES[index % JOB_IMAGES.length] ?? JOB_IMAGES[0]} locale={locale} t={t} />)}
        </ul>
      )}
    </section>
  );
}

function Opportunity({ job, image, locale, t }: { job: OpportunityRow; image: string; locale: Locale; t: TranslateFn }) {
  const place = [job.city, job.governorate].filter(Boolean).join("، ");
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface shadow-card transition-[transform,box-shadow] duration-base hover:-translate-y-1 hover:shadow-lg">
      <div className="relative h-36 bg-surface-2 tablet:h-40">
        <Image src={image} alt="" width={640} height={360} className="h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        {job.trade_key ? <span className="absolute bottom-2.5 start-2.5 rounded-sm bg-black/60 px-2 py-0.5 text-caption font-medium text-white">{tradeLabel(t, job.trade_key)}</span> : null}
        {job.has_applied ? <span className="absolute end-2.5 top-2.5 rounded-pill bg-info px-2.5 py-1 text-label font-semibold text-white">{locale === "ar" ? "تم التقديم" : "Applied"}</span> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div>
          <h3 dir="auto" className="text-body-lg font-semibold leading-snug text-fg">{job.title}</h3>
          {job.poster_org_name ? <p dir="auto" className="mt-0.5 text-caption text-fg-secondary">{job.poster_org_name}</p> : null}
        </div>
        <p className="text-caption text-fg-secondary">
          {[place, job.expected_duration_days ? (locale === "ar" ? `${formatNumber(job.expected_duration_days, locale)} يوم` : `${formatNumber(job.expected_duration_days, locale)} days`) : null].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 border-t pt-2.5">
          <div>
            <p className="font-mono text-body-lg font-bold text-success">{formatMoney(job.offered_amount, locale)}</p>
            {job.published_at ? <p className="text-caption text-fg-muted">{formatRelativeTime(job.published_at, locale)}</p> : null}
          </div>
          <Link href={`/home/jobs/${job.id}`} className="rounded-sm bg-iris-solid px-3 py-1.5 text-label font-medium text-white hover:brightness-105">{locale === "ar" ? "التفاصيل" : "Details"}</Link>
        </div>
      </div>
    </li>
  );
}

function WorkModule({ assignment, locale }: { assignment: MyAssignmentRow | null; locale: Locale }) {
  return (
    <ModuleCard id="attention" icon={ClipboardIcon} iconClassName="bg-warning/10 text-warning" title={locale === "ar" ? "شغلي الحالي" : "Current work"} footer={<ModuleFooterLink href="/home/work">{locale === "ar" ? "عرض كل الأعمال" : "View all work"}</ModuleFooterLink>}>
      <CurrentWorkBlock assignment={assignment} locale={locale} />
    </ModuleCard>
  );
}

function NetworkModule({ network, count, locale }: { network: readonly NetworkOrganization[]; count: number; locale: Locale }) {
  return (
    <ModuleCard id="ecosystem" icon={FactoryIcon} iconClassName="bg-bronze/10 text-bronze" title={locale === "ar" ? "شبكة معارضي" : "My showroom network"} footer={<ModuleFooterLink href="/home/network">{locale === "ar" ? "عرض الشبكة" : "View network"}</ModuleFooterLink>}>
      <p className="font-mono text-title font-semibold text-fg">{formatNumber(count, locale)}</p>
      {network.length === 0 ? <Empty text={locale === "ar" ? "هنا هتظهر المعارض اللي أنجزت معاها شغل." : "Showrooms appear here after completed work."} /> : (
        <ul className="flex flex-col gap-2">
          {network.slice(0, 4).map((org) => (
            <li key={org.orgId} className="rounded-md border bg-surface-2/40 p-2.5">
              <p dir="auto" className="text-body font-medium text-fg">{org.orgName}</p>
              <p className="text-caption text-fg-muted">{locale === "ar" ? `${formatNumber(org.completedCount, locale)} أعمال مكتملة` : `${formatNumber(org.completedCount, locale)} completed jobs`}</p>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}

function LearningModule({ locale }: { locale: Locale }) {
  return (
    <ModuleCard id="learning" icon={VideoIcon} iconClassName="bg-lapis/10 text-lapis" title={locale === "ar" ? "تعلم وتدرب" : "Learn & train"}>
      <Empty text={locale === "ar" ? "المحتوى التدريبي هيظهر هنا لما يتم نشره على المنصة." : "Training content will appear here once it is published."} />
    </ModuleCard>
  );
}

function ReputationModule({ points, average, reviewCount, completedJobs, locale }: { points: number; average: number | null; reviewCount: number; completedJobs: number; locale: Locale }) {
  return (
    <ModuleCard id="rewards" icon={GiftIcon} iconClassName="bg-iris-solid/10 text-iris" title={locale === "ar" ? "نقاطي وسمعتي" : "Points & reputation"} footer={<ModuleFooterLink href="/home/points">{locale === "ar" ? "سجل النقاط" : "Points history"}</ModuleFooterLink>}>
      <div className="flex items-center gap-3 rounded-md border bg-surface-2/40 p-3">
        <Image src="/assets/installer-dashboard/rewards/medal.webp" alt="" width={44} height={44} className="h-11 w-11 object-contain" />
        <p className="font-mono text-headline text-fg">{formatNumber(points, locale)}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-body text-fg-secondary">
        <Link href="/home/reviews" className="flex items-center gap-1.5 hover:text-fg"><StarIcon size={14} className="text-accent-solid" /><span className="font-mono font-semibold">{average === null ? "—" : formatNumber(average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span><span className="text-caption text-fg-muted">({formatNumber(reviewCount, locale)})</span></Link>
        <Link href="/home/work" className="flex items-center gap-1.5 hover:text-fg"><ClipboardIcon size={14} className="text-success" /><span className="font-mono font-semibold">{formatNumber(completedJobs, locale)}</span><span className="text-caption text-fg-muted">{locale === "ar" ? "منجز" : "done"}</span></Link>
      </div>
    </ModuleCard>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed bg-surface-2/30 p-4 text-center text-body text-fg-muted">{text}</div>;
}
