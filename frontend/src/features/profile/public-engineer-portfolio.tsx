import Image from "next/image";
import Link from "next/link";
import type { PublicProfile } from "@/server/queries/professional-profile";
import type { PublicPortfolioItem } from "@/server/queries/portfolio";
import type { Review } from "@/server/queries/reviews";
import type { Locale } from "@/lib/i18n/locales";
import { createTranslator } from "@/lib/i18n/translate";
import { specializationLabel, tradeLabel } from "@/lib/i18n/trade-label";
import { languageLabel } from "@/lib/i18n/language-label";
import { summarizeReviews } from "@/lib/reviews/summary";
import { I18nProvider } from "@/lib/i18n/context";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { ButtonLink } from "@/components/ui/controls";
import { BriefcaseIcon, StarIcon, MapPinIcon, BuildingIcon, PencilIcon, PackageIcon, UsersIcon, ShieldIcon } from "@/components/ui/icons";
import { AvailabilityBadge, AvailabilityAge } from "./availability-status";
import { availabilityState } from "@/lib/profile/availability-state";
import { PublicPortfolio } from "./public-portfolio";
import { PublicReviews } from "./public-reviews";
import { PublicShare } from "./public-share";
import "./public-engineer-portfolio.css";

/** Public projection only. Never import owner identity, collections or fixtures here. */
export function PublicEngineerPortfolio({ profile, portfolio, reviews, locale, theme }: {
  profile: PublicProfile; portfolio: PublicPortfolioItem[]; reviews: Review[]; locale: Locale; theme: "light" | "dark";
}) {
  const ar = locale === "ar";
  const t = createTranslator(locale);
  const name = profile.displayName?.trim() || t("profile.publicPage.unnamed");
  const summary = summarizeReviews(reviews);
  const specialties = profile.tradeKeys.length ? profile.tradeKeys.map(key => tradeLabel(t, key)) : profile.specialization ? [specializationLabel(t, profile.specialization)] : [];
  const serviceIcons = [BuildingIcon, PencilIcon, PackageIcon, UsersIcon, BriefcaseIcon];
  return <I18nProvider locale={locale} dir={ar ? "rtl" : "ltr"}><div className="public-engineer" data-testid="public-engineer-portfolio">
    <a href="#main" className="sr-only focus:not-sr-only">{ar ? "انتقل للمحتوى" : "Skip to content"}</a>
    <header className="public-engineer-topbar"><Link href="/" className="public-engineer-brand">{ar ? "علاء الدين" : "Aladdin"}<BuildingIcon size={30} /></Link><nav aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}><Link href="/">{ar ? "الرئيسية" : "Home"}</Link>{portfolio.length > 0 && <a href="#projects">{ar ? "المشاريع" : "Projects"}</a>}{profile.services.length > 0 && <a href="#services">{ar ? "الخدمات" : "Services"}</a>}</nav><div className="public-engineer-tools"><LanguageSwitch /><ThemeSwitch current={theme} /><ButtonLink href={`/auth/sign-in?next=${encodeURIComponent(`/p/${profile.id}`)}`} variant="outline" size="sm">{ar ? "دخول" : "Sign in"}</ButtonLink></div></header>
    <div className="public-engineer-breadcrumb"><Link href="/">{ar ? "الرئيسية" : "Home"}</Link><span aria-hidden="true">/</span><span>{ar ? "ملف مهندس" : "Engineer portfolio"}</span><span aria-hidden="true">/</span><bdi>{name}</bdi></div>
    <main id="main">
      <section className="public-engineer-hero" aria-labelledby="engineer-name"><Image src="/assets/engineer/hero-living-room.webp" alt="" fill priority sizes="100vw" className="public-engineer-cover" /><div className="public-engineer-intro"><div className="public-engineer-name"><span className="public-engineer-avatar" aria-hidden="true">{Array.from(name)[0]}</span><div><h1 id="engineer-name"><bdi>{name}</bdi></h1><p>{profile.headline || (ar ? "مهندس" : "Engineer")}</p>{summary.average !== null && <span className="public-engineer-rating"><StarIcon size={16} /><bdi>{summary.average.toFixed(1)}</bdi> ({summary.total} {ar ? "تقييم" : "reviews"})</span>}</div></div>
        {profile.serviceAreas.length > 0 && <p className="public-engineer-meta"><MapPinIcon size={17} />{profile.serviceAreas.map(key => t(`onboarding.consumer.cities.${key}`)).join(" · ")}</p>}
        {profile.yearsExperience !== null && <p className="public-engineer-meta"><BriefcaseIcon size={17} />{profile.yearsExperience} {ar ? "سنوات خبرة" : "years of experience"}</p>}
        <div className="public-engineer-availability"><AvailabilityBadge state={availabilityState(profile.availableForWork, profile.availabilityUpdatedAt)} t={t} /><AvailabilityAge updatedAt={profile.availabilityUpdatedAt} locale={locale} t={t} /></div>
        <div className="public-engineer-actions">{portfolio.length > 0 && <ButtonLink href="#projects" variant="accent">{ar ? "استعرض الأعمال" : "Explore projects"}</ButtonLink>}<PublicShare profileId={profile.id} locale={locale} /></div>
      </div></section>
      {(specialties.length > 0 || profile.yearsExperience !== null || summary.total > 0 || portfolio.length > 0) && <div className="public-engineer-statbar">
        {specialties.length > 0 && <div><BuildingIcon /><span><strong>{specialties[0]}</strong><small>{ar ? "التخصص الرئيسي" : "Primary specialization"}</small></span></div>}
        {profile.yearsExperience !== null && <div><BriefcaseIcon /><span><strong>{profile.yearsExperience}</strong><small>{ar ? "سنوات الخبرة" : "Years of experience"}</small></span></div>}
        {summary.average !== null && <div><StarIcon /><span><strong>{summary.average.toFixed(1)}</strong><small>{ar ? "تقييم العملاء" : "Client rating"}</small></span></div>}
        {portfolio.length > 0 && <div><PackageIcon /><span><strong>{portfolio.length}</strong><small>{ar ? "أعمال منشورة" : "Published works"}</small></span></div>}
      </div>}
      <nav className="public-engineer-section-nav" aria-label={ar ? "أقسام الملف العام" : "Public profile sections"}><a href="#overview">{ar ? "نبذة عامة" : "Overview"}</a>{portfolio.length > 0 && <a href="#projects">{ar ? "المشاريع" : "Projects"}</a>}{profile.services.length > 0 && <a href="#services">{ar ? "الخدمات" : "Services"}</a>}{reviews.length > 0 && <a href="#reviews">{ar ? "التقييمات" : "Reviews"}</a>}<a href="#share">{ar ? "مشاركة الملف" : "Share profile"}</a></nav>
      <div className="public-engineer-body">
        {portfolio.length > 0 && <section id="projects" className="public-engineer-projects"><PublicPortfolio items={portfolio} t={t} /></section>}
        <section id="overview" className="public-engineer-overview"><article><h2>{ar ? "نبذة عني" : "About me"}</h2><p className="public-engineer-bio">{profile.bio || (ar ? "تعرّف على هذا المهندس من خلال المعلومات التي اختار نشرها على منصة علاء الدين." : "Discover this engineer through the information they have chosen to publish on Aladdin.")}</p>{profile.languages.length > 0 && <p className="public-engineer-languages">{ar ? "اللغات" : "Languages"}: {profile.languages.map(key => languageLabel(t, key)).join(" · ")}</p>}</article>
        {specialties.length > 0 && <article><h2>{ar ? "التخصصات" : "Specializations"}</h2><div className="public-engineer-specialties">{specialties.map(label => <div key={label}><BuildingIcon size={28} /><span>{label}</span></div>)}</div></article>}</section>
        {profile.services.length > 0 && <section id="services" className="public-engineer-services"><h2>{ar ? "الخدمات التي أقدمها" : "Services I offer"}</h2><div>{profile.services.map((service, i) => { const Icon = serviceIcons[i % serviceIcons.length]!; return <article key={service}><Icon size={32} /><h3>{t(`onboarding.professional.serviceItems.${service}`)}</h3></article>; })}</div></section>}
        {reviews.length > 0 && <section id="reviews" className="public-engineer-reviews"><PublicReviews reviews={reviews} t={t} locale={locale} /></section>}
        <section id="share" className="public-engineer-cta"><div><h2>{ar ? "تصميم يستحق المشاركة" : "Design worth sharing"}</h2><p>{ar ? "شارك الملف العام للاطلاع على الأعمال والخدمات المنشورة." : "Share this portfolio to explore published work and services."}</p></div><PublicShare profileId={profile.id} locale={locale} /></section>
        <footer className="public-engineer-footer"><ShieldIcon size={17} /><p>{ar ? "يعرض هذا الملف المعلومات والأعمال المتاحة للنشر العام فقط." : "This portfolio shows only information and work available for public viewing."}</p><Link href="/legal/privacy">{ar ? "الخصوصية" : "Privacy"}</Link></footer>
      </div>
    </main>
  </div></I18nProvider>;
}
