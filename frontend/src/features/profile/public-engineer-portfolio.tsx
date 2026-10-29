import Image from "next/image";
import Link from "next/link";
import type { PublicProfile } from "@/server/queries/professional-profile";
import type { PublicPortfolioItem } from "@/server/queries/portfolio";
import type { Review } from "@/server/queries/reviews";
import type { Locale } from "@/lib/i18n/locales";
import { createTranslator } from "@/lib/i18n/translate";
import { specializationLabel, tradeLabel } from "@/lib/i18n/trade-label";
import { summarizeReviews } from "@/lib/reviews/summary";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import { BriefcaseIcon, StarIcon, MapPinIcon, BuildingIcon, PencilIcon, PackageIcon, HomeIcon, MonitorIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { PublicShare } from "./public-share";
import { portfolioSampleContent } from "./public-portfolio-samples";
import { PortfolioRail, PortfolioSampleActions } from "./portfolio-controls";
import { PublicPortfolioTabs } from "./public-portfolio-tabs";
import "./public-engineer-portfolio.css";

export function PublicEngineerPortfolio({profile, portfolio, reviews, locale, sample = false}: {
  profile: PublicProfile; portfolio: PublicPortfolioItem[]; reviews: Review[]; locale: Locale; theme: "light" | "dark"; sample?: boolean;
}) {
  const ar = locale === "ar", t = createTranslator(locale);
  const demo = sample ? portfolioSampleContent(locale) : null;
  const name = demo?.name ?? (profile.displayName?.trim() || t("profile.publicPage.unnamed"));
  const visibleReviews = demo?.reviews ?? reviews, summary = summarizeReviews(visibleReviews);
  const specialties = demo?.specialties ?? (profile.tradeKeys.length ? profile.tradeKeys.map(key => tradeLabel(t, key)) : profile.specialization ? [specializationLabel(t, profile.specialization)] : []);
  const services = demo?.services ?? profile.services.map(s => t(`onboarding.professional.serviceItems.${s}`));
  const years = demo ? 10 : profile.yearsExperience, projects = demo?.projects ?? portfolio;
  const icons = [BuildingIcon, MonitorIcon, HomeIcon, PencilIcon, BriefcaseIcon];
  const actions = demo ? <PortfolioSampleActions ar={ar} /> : <PublicShare profileId={profile.id} locale={locale} />;
  const heading = (title: string, subtitle?: string, target?: string, linkLabel?: string) => <div className="portfolio-section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{target && <a className="portfolio-small-link" href={target}>{linkLabel}<ArrowUpRightIcon size={15} /></a>}</div>;
  return <I18nProvider locale={locale} dir={ar ? "rtl" : "ltr"}><div className="public-engineer" data-testid="public-engineer-portfolio" dir={ar ? "rtl" : "ltr"}>
    <a href="#main" className="sr-only focus:not-sr-only">{ar ? "انتقل للمحتوى" : "Skip to content"}</a>
    <LandingHeader linkToLanding />
    {demo && <aside className="portfolio-sample-notice">{ar ? "بيانات وصور توضيحية محلية لمراجعة التصميم — ليست أعمالاً أو تقييمات حقيقية لهذا الحساب." : "Local illustrative data for design review — not this account’s real projects or reviews."}</aside>}
    <div className="public-engineer-breadcrumb"><Link href="/">{ar ? "الرئيسية" : "Home"}</Link><span aria-hidden="true">‹</span><Link href="/home/engineer/professionals">{ar ? "المهندسين والمكاتب" : "Professionals"}</Link><span aria-hidden="true">‹</span><bdi>{name}</bdi></div>
    <main id="main">
      <section className="public-engineer-hero" aria-labelledby="engineer-name"><Image src="/assets/engineer/hero-living-room.webp" alt="" fill priority sizes="100vw" className="public-engineer-cover" /><div className="public-engineer-intro"><div className="public-engineer-identity">
        <div className="public-engineer-name"><span className={`public-engineer-avatar ${demo ? "portfolio-sample-avatar" : ""}`} aria-hidden="true">{!demo && Array.from(name)[0]}</span><div><h1 id="engineer-name"><bdi>{name}</bdi></h1><p>{demo?.headline ?? (profile.headline || (ar ? "مهندس" : "Engineer"))}</p>{summary.average !== null && <span className="public-engineer-rating"><bdi>{summary.average.toFixed(1)}</bdi><StarIcon size={14} /><span>({summary.total} {ar ? "تقييم" : "reviews"})</span></span>}</div></div>
        {(demo || profile.serviceAreas.length > 0) && <p className="public-engineer-meta"><MapPinIcon size={16} />{demo ? (ar ? "القاهرة، مصر" : "Cairo, Egypt") : profile.serviceAreas.map(key => t(`onboarding.consumer.cities.${key}`)).join(" · ")}</p>}
        {years !== null && <p className="public-engineer-meta"><BriefcaseIcon size={16} /><bdi>{years}{demo ? "+" : ""}</bdi> {ar ? "سنوات خبرة" : "years of experience"}</p>}
        <div className="public-engineer-actions">{actions}</div>
      </div></div></section>
      {(specialties.length > 0 || years !== null || summary.total > 0 || projects.length > 0) && <div className="public-engineer-statbar">
        {specialties.length > 0 && <div><span className="portfolio-stat-icon"><MonitorIcon /></span><span><strong className="portfolio-specialty-stat">{demo ? (ar ? "تصميم داخلي وخارجي" : "Interior & exterior design") : specialties[0]}</strong><small>{ar ? "التخصص الرئيسي" : "Primary specialization"}</small></span></div>}
        {years !== null && <div><span className="portfolio-stat-icon"><BriefcaseIcon /></span><span><strong>{years}{demo ? "+" : ""}</strong><small>{ar ? "سنوات خبرة" : "Years of experience"}</small></span></div>}
        {summary.average !== null && <div><span className="portfolio-stat-icon"><StarIcon /></span><span><strong>{summary.average.toFixed(1)}</strong><small>{ar ? "تقييم العملاء" : "Client rating"}</small></span></div>}
        {projects.length > 0 && <div><span className="portfolio-stat-icon"><PackageIcon /></span><span><strong>{projects.length}</strong><small>{ar ? "أعمال منشورة" : "Published works"}</small></span></div>}
      </div>}
      <PublicPortfolioTabs ar={ar} panels={[
        {id: "overview", label: ar ? "نبذة عامة" : "Overview", content: (<section id="overview" className="public-engineer-overview">
          {specialties.length > 0 && <article><h2>{ar ? "التخصصات" : "Specializations"}</h2><div className="public-engineer-specialties">{specialties.map((label, i) => {const Icon = icons[i % icons.length]!; return <div key={label} data-portfolio-search tabIndex={-1}><Icon size={26} /><span>{label}</span></div>;})}</div></article>}
          <article><h2>{ar ? "نبذة عني" : "About me"}</h2><p className="public-engineer-bio">{demo?.bio ?? profile.bio ?? (ar ? "تعرّف على هذا المهندس من خلال المعلومات التي اختار نشرها على منصة علاء الدين." : "Discover this engineer through the information they have chosen to publish on Aladdin.")}</p></article>
        </section>)},
        ...(projects.length > 0 ? [{id: "projects", label: ar ? "المشاريع" : "Projects", content: (<section id="projects" className="public-engineer-projects">{heading(ar ? "أبرز المشاريع" : "Featured projects", ar ? "مجموعة من أعمال التصميم والتنفيذ التي تعكس خبرتي وأسلوبي العملي" : "A selection of spaces, thoughtfully designed and carefully brought to life.")}
          <PortfolioRail ar={ar} id="project-rail">{projects.map((item, i) => <article className="portfolio-project" key={item.id} data-portfolio-search tabIndex={-1}><div className="portfolio-project-photo">{demo ? <div role="img" aria-label={item.title} className="portfolio-sample-project" style={{backgroundPosition: `${[3,0,1,2][i]! % 2 ? "100%" : "0%"} ${[3,0,1,2][i]! > 1 ? "100%" : "0%"}`}} /> : <Image unoptimized src={`/p/media/${item.id}`} alt={item.title} fill sizes="(max-width: 600px) 80vw, 25vw" />}{demo && <><span className="portfolio-project-tag">{demo.projects[i]!.category}</span><span className="portfolio-photo-count"><PackageIcon size={14} />{demo.projects[i]!.count}</span></>}</div><h3><bdi>{item.title}</bdi></h3>{item.description && <p>{demo && <MapPinIcon size={13} />}<bdi>{item.description}</bdi></p>}</article>)}</PortfolioRail>
        </section>)}] : []),
        ...(services.length > 0 ? [{id: "services", label: ar ? "الخدمات" : "Services", content: (<section id="services" className="public-engineer-services">{heading(ar ? "الخدمات التي أقدمها" : "Services I offer", ar ? "حلول متكاملة من الفكرة إلى التنفيذ" : "From the first idea to the finishing details")}<div className="portfolio-services-grid">{services.map((service, i) => {const Icon = icons[i % icons.length]!; return <article key={service} data-portfolio-search tabIndex={-1}><h3><Icon size={18} />{service}</h3><div className="portfolio-service-photo" role="img" aria-label={ar ? `صورة توضيحية: ${service}` : `Illustration: ${service}`} style={{backgroundPosition: `${i < 3 ? i * 50 : (i - 3) * 50}% ${i < 3 ? 0 : 100}%`}} /></article>;})}</div></section>)}] : []),
        ...(visibleReviews.length > 0 ? [{id: "reviews", label: ar ? "التقييمات" : "Reviews", content: (<section id="reviews" className="public-engineer-reviews">{heading(ar ? "تقييمات العملاء" : "Client reviews")}<PortfolioRail id="review-rail" ar={ar}>{visibleReviews.map(review => <article className="portfolio-review" key={review.id}><div className="portfolio-stars" aria-label={ar ? `${review.rating} من 5` : `${review.rating} out of 5`}>{Array.from({length: 5}, (_, i) => <StarIcon size={13} key={i} fill={i < review.rating ? "currentColor" : "none"} />)}<bdi>{review.rating.toFixed(1)}</bdi></div><p>{review.comment}</p><div className="portfolio-review-person"><span aria-hidden="true">{Array.from(review.orgName)[0]}</span><div><h3><bdi>{review.orgName}</bdi></h3><small><bdi>{review.jobTitle}</bdi></small></div></div></article>)}</PortfolioRail></section>)}] : []),
        {id: "contact", label: ar ? "التواصل" : "Contact", content: (<section id="contact" className="public-engineer-cta"><div className="portfolio-cta-photo" aria-hidden="true" /><div><h2>{ar ? "ابدأ مشروعك الآن" : "Bring your next project to life"}</h2><p>{demo ? (ar ? `تواصل مع ${name} لمناقشة تفاصيل مشروعك والحصول على عرض سعر مخصص` : `Discuss your project with ${name} and explore what is possible.`) : (ar ? "شارك هذا الملف للاطلاع على الأعمال والخدمات المنشورة." : "Share this portfolio to explore published work and services.")}</p></div>{demo ? <PortfolioSampleActions ar={ar} compact /> : <PublicShare profileId={profile.id} locale={locale} />}</section>)}
      ]} />
    </main>
  </div></I18nProvider>;
}
