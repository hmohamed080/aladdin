"use client";

import Image from "next/image";
import { ArrowUpRightIcon, BriefcaseIcon, BuildingIcon, CheckIcon, PackageIcon, UserIcon, WrenchIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-ecosystem.module.css";

const copy = {
  ar: {
    worksTitle: "كيف يعمل Aladdin؟", worksText: "من الاحتياج إلى القرار، يجمع علاء الدين أطراف التشطيبات في مسار واضح.",
    flow: [[BuildingIcon, "المصنّعون", "يعرضون منتجاتهم وخبراتهم"], [PackageIcon, "الموردون", "يوصلون الخيارات إلى السوق"], [BriefcaseIcon, "المعارض", "تساعد العملاء على الاكتشاف"], [UserIcon, "المحترفون", "يقدمون المشورة والتنفيذ"], [WrenchIcon, "صاحب المشروع", "يصل إلى قرار أفضل"]] as const,
    rolesTitle: "لأن كل دور مهم", roles: [["للمصنّعين والمستوردين", "اعرض منتجاتك ووصل إلى طلبات أكثر"], ["للموردين والمعارض", "نظّم الكتالوج وتواصل مع العملاء مباشرة"], ["للمحترفين", "اكتشف منتجات موثوقة وابنِ حضورك المهني"]] as const,
    explore: "استكشف المنصة", partnersTitle: "علامات يكتشفها مجتمع التشطيبات", partnersText: "مجموعة من العلامات المرفوعة للعرض داخل تجربة المنصة.",
  },
  en: {
    worksTitle: "How Aladdin works", worksText: "From a need to a decision, Aladdin brings the finishing ecosystem into one clear path.",
    flow: [[BuildingIcon, "Manufacturers", "Share products and expertise"], [PackageIcon, "Suppliers", "Bring options to the market"], [BriefcaseIcon, "Showrooms", "Help people discover"], [UserIcon, "Professionals", "Advise and execute"], [WrenchIcon, "Project owners", "Reach a better decision"]] as const,
    rolesTitle: "Every role matters", roles: [["For manufacturers and importers", "Put your products in front of more demand"], ["For suppliers and showrooms", "Organize your catalogue and talk directly"], ["For professionals", "Discover trusted products and build your profile"]] as const,
    explore: "Explore the platform", partnersTitle: "Brands discovered by the finishing community", partnersText: "A selection of supplied brand assets shown inside the platform experience.",
  },
} as const;

const logos = [["venecia.png", "Venecia"], ["shbab.png", "Shbab"], ["ahmed-el-sallab.png", "Ahmed El Sallab"], ["elsalam.png", "Elsalam"], ["konouz.png", "Konouz Decoration"], ["jazeerah.png", "Jazeerah Paints"], ["glc.png", "GLC Paints"], ["jotun.png", "Jotun"], ["scib.png", "SCIB Paints"]] as const;

export function LandingEcosystem() {
  const { locale, dir } = useI18n(); const t = copy[locale];
  return <section className={styles.section} id="how-it-works" data-landing-preview-part="Ecosystem">
    <Reveal className={styles.intro}><p className={styles.kicker}>ALADDIN / ECOSYSTEM</p><h2 dir={dir}>{t.worksTitle}</h2><p dir={dir}>{t.worksText}</p></Reveal>
    <div className={styles.flow} dir="ltr">{t.flow.map(([Icon, title, text], index) => <div className={styles.flowItem} key={title}><div className={styles.flowIcon}><Icon size={22} aria-hidden="true" /></div><h3 dir={dir}>{title}</h3><p dir={dir}>{text}</p>{index < t.flow.length - 1 ? <ArrowUpRightIcon className={styles.arrow} size={20} aria-hidden="true" /> : null}</div>)}</div>
    <Reveal className={styles.rolesBlock}><h2 dir={dir}>{t.rolesTitle}</h2><div className={styles.roles}>{t.roles.map(([title, text]) => <article key={title}><CheckIcon size={20} aria-hidden="true" /><h3 dir={dir}>{title}</h3><p dir={dir}>{text}</p><a href="/auth/sign-up" dir={dir}>{t.explore} <ArrowUpRightIcon size={15} aria-hidden="true" /></a></article>)}</div></Reveal>
    <Reveal className={styles.partners}><div className={styles.partnerIntro}><h2 dir={dir}>{t.partnersTitle}</h2><p dir={dir}>{t.partnersText}</p></div><ul className={styles.logoGrid} aria-label={t.partnersTitle}>{logos.map(([file, alt]) => <li key={alt}><Image src={`/preview/landing/partners/${file}`} alt={alt} width={180} height={110} /></li>)}</ul></Reveal>
  </section>;
}
