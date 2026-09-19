"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ButtonLink } from "@/components/ui/controls";
import { ArrowUpRightIcon, GlobeIcon } from "@/components/ui/icons";
import { LanguageSwitch } from "@/components/layout/switchers";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-hero.module.css";
import widthStyles from "./landing-hero-width.module.css";

const content = {
  ar: {
    navLabel: "التنقل الرئيسي",
    // Relative anchors keep review navigation inside `/preview/landing`.
    nav: [
      ["المنصة", "#platform"],
      ["الحلول", "#value"],
      ["لمن علاء الدين", "#audience"],
      ["كيف يعمل", "#how-it-works"],
    ],
    eyebrow: "قطاع التشطيبات في مصر",
    brandLine: "علاء الدين",
    headline: "يربط كل أطراف التشطيبات",
    support: "في منصة واحدة",
    start: "ابدأ الآن",
    signIn: "تسجيل الدخول",
    createAccount: "إنشاء حساب",
    // Qualitative proof only: this preview must not introduce unsupported metrics.
    proof: [
      ["موثوق", "منتجات وخيارات"],
      ["مباشر", "تواصل مع السوق"],
      ["واضح", "من الاحتياج للقرار"],
    ],
  },
  en: {
    navLabel: "Primary navigation",
    nav: [
      ["Platform", "#platform"],
      ["Solutions", "#value"],
      ["Who it is for", "#audience"],
      ["How it works", "#how-it-works"],
    ],
    eyebrow: "Egypt's finishing sector",
    brandLine: "Aladdin",
    headline: "Connects every side of finishing",
    support: "On one platform",
    start: "Start now",
    signIn: "Sign in",
    createAccount: "Create account",
    proof: [
      ["Trusted", "products & options"],
      ["Direct", "market connection"],
      ["Clear", "need to decision"],
    ],
  },
} as const;

const copyItem = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  shown: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.72, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function LandingHero() {
  const { locale, dir } = useI18n();
  const copy = content[locale];
  const isArabic = locale === "ar";

  return (
    <section
      // Asymmetric outer gutter — the approved reference reads as slightly
      // MORE breathing room above the frame than beside it, not the uniform
      // 8px this replaced (which put too much air on the sides and too
      // little on top for the near-full-bleed composition the reference
      // uses).
      className={`${widthStyles.section} pb-sm pt-[12px] px-[5px]`}
      aria-labelledby="landing-preview-title"
      data-landing-preview-part="Hero"
    >
      <div
        className={styles.heroFrame}
        dir="ltr"
      >
        <div
          className={styles.scene}
          data-landing-preview-part="ShowroomVisual"
        >
          {/* Runtime-trimmed derivative of
              `UI-UX/references/landing/background (2).png`
              (`background-2-new.png` is the untouched byte-identical copy
              of that reference, still on disk). This file is a lossless
              pixel crop of it — rows 105–839 of the native 1728×910
              canvas, i.e. only the fully-transparent outer margin (alpha
              ≤10, confirmed noise) trimmed from the top and bottom; no
              visible artwork or cutout geometry removed, nothing resized
              or regenerated. Original `background-2.png` (1672×941) is
              untouched on disk for instant rollback. */}
          <Image
            src="/preview/landing/hero/background-2-new-trimmed.png"
            alt=""
            width={1728}
            height={735}
            priority
            sizes="100vw"
          />
        </div>

        <div
          className={styles.brandCap}
          data-landing-preview-part="BrandCap"
        >
          <Image
            src="/preview/landing/aladdin-logo.png"
            alt="Aladdin"
            width={684}
            height={643}
            priority
            className={styles.brandLogo}
          />
        </div>

        <div
          className={styles.actionCap}
          data-landing-preview-part="ActionCap"
        >
          <span className={styles.languageControl}>
            <LanguageSwitch />
            <GlobeIcon size={14} aria-hidden="true" />
          </span>
          <span className={styles.actionDivider} aria-hidden="true" />
          <a
            href="/auth/sign-in"
            dir={dir}
            className={`${styles.signIn} rounded-sm font-medium text-brand-ink transition-colors duration-fast hover:text-brand-lumen-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
          >
            {copy.signIn}
          </a>
          <ButtonLink
            href="/auth/sign-up"
            variant="accent"
            size="sm"
            className={`${styles.accountCta} rounded-pill ps-md`}
          >
            <span dir={dir}>{copy.createAccount}</span>
            <span className={styles.actionIcon}>
              <ArrowUpRightIcon size={16} strokeWidth={2} />
            </span>
          </ButtonLink>
        </div>

        <motion.nav
          aria-label={copy.navLabel}
          className={styles.navigation}
          data-landing-preview-part="Navigation"
          dir={dir}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {copy.nav.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className={`${styles.navLink} rounded-xs font-medium text-brand-limestone/80 transition-colors duration-fast hover:text-brand-limestone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus`}
            >
              {label}
            </a>
          ))}
        </motion.nav>

        <motion.div
          className={`${styles.copy} ${isArabic ? styles.copyArabic : styles.copyEnglish}`}
          data-landing-preview-part="HeroContent"
          dir={dir}
          variants={{
            hidden: {},
            shown: { transition: { staggerChildren: 0.11, delayChildren: 0.34 } },
          }}
          initial={false}
          animate="shown"
        >
          <motion.p variants={copyItem} className={`${styles.eyebrow} font-medium text-brand-limestone/70`}>
            {copy.eyebrow}
          </motion.p>
          <h1 id="landing-preview-title" className="m-0 text-balance">
            <motion.span
              variants={copyItem}
              className={`block text-brand-lumen ${isArabic ? "font-display-ar" : "font-display"} ${styles.brandHeadline}`}
            >
              {copy.brandLine}
            </motion.span>
            <motion.span
              variants={copyItem}
              className={`block text-brand-limestone ${isArabic ? "font-display-ar" : "font-display"} ${styles.mainHeadline}`}
            >
              {copy.headline}
            </motion.span>
          </h1>
          <motion.p variants={copyItem} className={`${styles.supportCopy} text-brand-limestone/80`}>
            {copy.support}
          </motion.p>
          <motion.div variants={copyItem} className={styles.ctaWrap} data-landing-preview-part="CTA">
            <ButtonLink
              href="/auth/sign-up"
              variant="accent"
              size="md"
              className={`${styles.heroCta} rounded-pill`}
            >
              <span dir={dir}>{copy.start}</span>
              <span className={styles.ctaIcon}>
                <ArrowUpRightIcon size={18} strokeWidth={2} />
              </span>
            </ButtonLink>
          </motion.div>
          <motion.ul
            variants={copyItem}
            className={styles.proofStrip}
            aria-label={copy.proof.map(([value, label]) => `${value} ${label}`).join("، ")}
          >
            {copy.proof.map(([value, label]) => (
              <li key={label}>
                <strong dir="ltr">{value}</strong>
                <span>{label}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </div>
    </section>
  );
}
