"use client";

import { useState, type ComponentType } from "react";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import {
  BadgeCheckIcon,
  BriefcaseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GiftIcon,
  HelpIcon,
  MapPinIcon,
  MessageIcon,
  PhoneIcon,
  ScrollIcon,
  SettingsIcon,
  ShieldIcon,
  StarIcon,
  StorefrontIcon,
  UserIcon,
} from "@/components/ui/icons";
import { ProgressMeter } from "@/components/ui/primitives";
import { InstallerSidebar } from "@/features/installer-dashboard-preview/installer-sidebar";
import { InstallerTopbar } from "@/features/installer-dashboard-preview/installer-topbar";
import { INSTALLER_CONTENT_FRAME_CLASS, INSTALLER_SHELL_GUTTER_CLASS } from "@/features/installer-dashboard-preview/installer-layout";
import { pick } from "@/features/installer-dashboard-preview/mock-data";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { cn } from "@/lib/ui/cn";
import { ACCOUNT_MODULES, ACCOUNT_PROFILE, ACCOUNT_STATS, SETTINGS_ROWS, type AccountModule } from "./preview-data";

const statIcons = {
  points: GiftIcon,
  jobs: BriefcaseIcon,
  rating: StarIcon,
  reviews: MessageIcon,
} as const;

const moduleIcons = {
  network: StorefrontIcon,
  skills: BadgeCheckIcon,
  learning: ScrollIcon,
  settings: SettingsIcon,
  reviews: StarIcon,
  rewards: GiftIcon,
} as const;

const moduleTones = {
  info: "border-info/20 bg-info/5 text-info",
  success: "border-success/20 bg-success/5 text-success",
  iris: "border-iris-solid/20 bg-iris-solid/5 text-iris-solid",
  neutral: "border-strong bg-surface-2/40 text-fg-secondary",
  danger: "border-danger/20 bg-danger/5 text-danger",
  warning: "border-warning/20 bg-warning/5 text-warning",
} as const;

export function InstallerAccountPreview({ theme, sidebarMode }: { theme: "light" | "dark"; sidebarMode: SidebarMode }) {
  const { locale, dir } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div dir={dir} className="installer-surface flex min-h-dvh bg-workspace">
      <InstallerSidebar
        initialMode={sidebarMode}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        previewActiveItemId="account"
      />

      <div className={`${INSTALLER_SHELL_GUTTER_CLASS} flex min-w-0 flex-1 flex-col gap-6 tablet:pb-10 tablet:pt-6 desktop:pt-8`}>
        <InstallerTopbar theme={theme} onMenuClick={() => setMobileNavOpen(true)} />
        <main id="top" className={`${INSTALLER_CONTENT_FRAME_CLASS} flex flex-1 flex-col gap-lg py-4 tablet:py-6 desktop:py-7`}>
          <PageHeading locale={locale} />
          <ProfileOverview locale={locale} />
          <section aria-label={locale === "ar" ? "أقسام الحساب" : "Account sections"} className="grid min-w-0 gap-md tablet:grid-cols-2 desktop:grid-cols-3">
            {ACCOUNT_MODULES.map((module) => <AccountModuleCard key={module.id} module={module} locale={locale} />)}
          </section>
          <SupportStrip locale={locale} />
        </main>
      </div>
    </div>
  );
}

function PageHeading({ locale }: { locale: Locale }) {
  return (
    <header>
      <h1 className="text-headline text-fg">{locale === "ar" ? "حسابي" : "My account"}</h1>
      <p className="mt-2 text-body-lg text-fg-secondary">
        {locale === "ar" ? "جميع معلوماتك وإحصائياتك في مكان واحد" : "Your information and activity in one place"}
      </p>
    </header>
  );
}

function ProfileOverview({ locale }: { locale: Locale }) {
  const ar = locale === "ar";

  return (
    <section id="profile" aria-labelledby="profile-name" className="grid items-center gap-lg rounded-md border bg-surface p-lg shadow-card desktop:grid-cols-[minmax(14rem,0.85fr)_minmax(0,1.65fr)] wide:grid-cols-[minmax(16rem,0.9fr)_minmax(32rem,1.7fr)_minmax(13rem,0.75fr)]">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-md">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-pill border-2 border-canvas bg-surface-2 shadow-raised tablet:h-28 tablet:w-28">
            <Image src={ACCOUNT_PROFILE.portrait} alt="" fill priority sizes="112px" className="object-cover" />
          </div>
          <div className="min-w-0">
            <h2 id="profile-name" className="text-title text-fg">{pick(locale, ACCOUNT_PROFILE.name)}</h2>
            <p className="mt-1 text-body text-fg-secondary">{pick(locale, ACCOUNT_PROFILE.profession)}</p>
            <p className="mt-2 flex items-center gap-1.5 text-label text-fg-secondary"><MapPinIcon size={15} />{pick(locale, ACCOUNT_PROFILE.location)}</p>
            <span className="mt-3 inline-flex items-center gap-2 rounded-pill bg-success/10 px-3 py-1.5 text-label font-semibold text-success">
              <span className="h-2 w-2 rounded-pill bg-success" aria-hidden="true" />{pick(locale, ACCOUNT_PROFILE.availability)}
            </span>
            <ButtonLink href="#public-profile" variant="outline" size="sm" className="mt-3 w-full gap-sm text-iris-solid wide:hidden">
              <UserIcon size={15} />{ar ? "عرض ملفي العام" : "View public profile"}
            </ButtonLink>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-md border bg-canvas tablet:grid-cols-4">
        {ACCOUNT_STATS.map((stat) => {
          const Icon = statIcons[stat.id];
          return (
            <div key={stat.id} className="flex min-h-24 items-center justify-center gap-sm border-b p-md [&:nth-child(odd)]:border-e [&:nth-child(n+3)]:border-b-0 tablet:border-b-0 tablet:[&:not(:last-child)]:border-e">
              <Icon size={23} className="shrink-0 text-accent-solid" />
              <div>
                <strong className="block text-title tabular-nums text-fg">{stat.value}</strong>
                <span className="text-label text-fg-secondary">{pick(locale, stat.label)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <ButtonLink href="#public-profile" variant="outline" className="hidden w-full gap-sm text-iris-solid wide:inline-flex">
        <UserIcon size={17} />{ar ? "عرض ملفي العام" : "View public profile"}
      </ButtonLink>
    </section>
  );
}

function AccountModuleCard({ module, locale }: { module: AccountModule; locale: Locale }) {
  const { dir } = useI18n();
  const Icon = moduleIcons[module.id];
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;
  const ar = locale === "ar";

  return (
    <article id={module.id} className={cn("relative flex min-h-[19rem] min-w-0 flex-col overflow-hidden rounded-md border p-lg shadow-card", moduleTones[module.tone])}>
      <div className="relative z-10 max-w-[68%]">
        <h2 className="flex items-center gap-sm text-title text-fg"><Icon size={24} className="shrink-0" />{pick(locale, module.title)}</h2>
        <p className="mt-2 text-body leading-relaxed text-fg-secondary">{pick(locale, module.description)}</p>
      </div>

      <div className="relative z-10 mt-md max-w-[54%]">
        {module.id === "settings" ? <SettingsRows locale={locale} /> : <ModuleMetric module={module} locale={locale} />}
      </div>

      <Image
        src={module.image}
        alt=""
        width={320}
        height={320}
        sizes="(min-width: 1280px) 190px, (min-width: 768px) 170px, 145px"
        className="pointer-events-none absolute bottom-12 end-0 h-36 w-36 object-contain tablet:h-40 tablet:w-40 desktop:h-36 desktop:w-36 wide:h-44 wide:w-44"
      />

      <ButtonLink href={module.href} variant="outline" size="sm" className="relative z-10 mt-auto w-[54%] justify-between border-strong bg-canvas/70 text-fg backdrop-blur-sm hover:bg-canvas">
        {ar ? "دخول" : "Open"}<Forward size={15} />
      </ButtonLink>
    </article>
  );
}

function ModuleMetric({ module, locale }: { module: AccountModule; locale: Locale }) {
  const ar = locale === "ar";
  return (
    <>
      <strong dir="ltr" className={cn("block w-fit font-semibold tabular-nums", module.id === "reviews" ? "text-headline" : "text-display")}>{module.metric}</strong>
      {module.id === "reviews" ? (
        <div className="my-2 flex gap-1 text-warning" aria-label={ar ? "4.8 من 5 نجوم" : "4.8 out of 5 stars"}>
          {[0, 1, 2, 3, 4].map((star) => <StarIcon key={star} size={18} />)}
        </div>
      ) : null}
      <p className="mt-1 text-label font-medium leading-relaxed text-fg">{pick(locale, module.metricLabel)}</p>
      {module.id === "skills" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["SPC", "WPC", ar ? "دهانات" : "Paint", ar ? "رخام" : "Marble"].map((skill) => <span key={skill} className="rounded-pill bg-canvas/70 px-2 py-1 text-[11px] font-semibold text-fg-secondary">{skill}</span>)}
        </div>
      ) : null}
      {module.id === "rewards" ? <div className="mt-3"><ProgressMeter value={97} label={ar ? "التقدم نحو المستوى التالي" : "Progress to the next level"} tone="warning" size="sm" /></div> : null}
    </>
  );
}

function SettingsRows({ locale }: { locale: Locale }) {
  const { dir } = useI18n();
  const Forward = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <ul className="overflow-hidden rounded-sm border border-strong/70 bg-canvas/70">
      {SETTINGS_ROWS.map((row, index) => (
        <li key={row.en} className={cn("flex min-h-8 items-center justify-between gap-sm px-sm text-[11px] text-fg", index > 0 && "border-t")}>
          <span className="flex min-w-0 items-center gap-1.5"><ShieldIcon size={12} className="shrink-0 text-fg-secondary" />{pick(locale, row)}</span>
          <Forward size={12} className="shrink-0 text-fg-muted" />
        </li>
      ))}
    </ul>
  );
}

function SupportStrip({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <section aria-label={ar ? "المساعدة والدعم" : "Help and support"} className="grid overflow-hidden rounded-md border bg-surface shadow-card tablet:grid-cols-3">
      <SupportItem Icon={HelpIcon} title={ar ? "تحتاج مساعدة؟" : "Need help?"} body={ar ? "فريق الدعم متاح لمساعدتك" : "Our support team is ready to help"} action={ar ? "تواصل مع الدعم" : "Contact support"} />
      <SupportItem Icon={PhoneIcon} title={ar ? "الخط الساخن" : "Hotline"} body={ar ? "من 9 ص إلى 9 م · 0100 123 4567" : "9 AM–9 PM · 0100 123 4567"} />
      <SupportItem Icon={ScrollIcon} title={ar ? "مركز المساعدة" : "Help center"} body={ar ? "تصفح المقالات والإرشادات" : "Browse guides and help articles"} action={ar ? "زيارة المركز" : "Visit center"} />
    </section>
  );
}

function SupportItem({ Icon, title, body, action }: { Icon: ComponentType<{ size?: number; className?: string }>; title: string; body: string; action?: string }) {
  return (
    <div className="flex min-h-28 items-center gap-md border-b p-lg last:border-b-0 tablet:border-b-0 tablet:[&:not(:last-child)]:border-e">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill bg-iris-solid/10 text-iris-solid"><Icon size={25} /></span>
      <div className="min-w-0">
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-label text-fg-secondary">{body}</p>
        {action ? <a href="#support" className="mt-2 inline-flex text-label font-semibold text-iris-solid hover:underline">{action}</a> : null}
      </div>
    </div>
  );
}

