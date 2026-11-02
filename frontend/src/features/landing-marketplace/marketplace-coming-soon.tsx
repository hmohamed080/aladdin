"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { LandingHeader } from "@/features/landing-preview/landing-header";
import { LandingFooter } from "@/features/landing-preview/landing-footer";
import widthStyles from "@/features/landing-preview/landing-hero-width.module.css";
import brand from "@/styles/brand-2026.module.css";
import styles from "./marketplace-coming-soon.module.css";

const content = {
  ar: {
    eyebrow: "سوق علاء الدين",
    title: "السوق قريبًا",
    text: "نجهّز سوق علاء الدين بمنتجات مختارة لأعمال التشطيبات والديكور. تابعنا، وسنفتحه قريبًا.",
    back: "العودة للرئيسية",
  },
  en: {
    eyebrow: "Aladdin Marketplace",
    title: "The Marketplace is coming soon",
    text: "We are preparing the Aladdin Marketplace with selected finishing and decoration products. Stay tuned.",
    back: "Back to home",
  },
} as const;

/** The /marketplace placeholder: the landing header and footer around a coming-soon message. */
export function MarketplaceComingSoon() {
  const { locale, dir } = useI18n();
  const t = content[locale];
  return (
    <main className={`${brand.brand} ${widthStyles.page} flex min-h-dvh flex-col overflow-x-hidden bg-brand-plaster`}>
      <div className={`${widthStyles.section} pb-sm pt-[12px] px-[5px]`}>
        <LandingHeader anchorBase="/" active="marketplace" />
      </div>
      <section className={styles.panel} dir={dir} aria-labelledby="marketplace-soon-title" data-marketplace-coming-soon="">
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h1 id="marketplace-soon-title" className={styles.title}>{t.title}</h1>
        <p className={styles.text}>{t.text}</p>
        <Link href="/" className={styles.back}>{t.back}</Link>
      </section>
      <LandingFooter anchorBase="/" />
    </main>
  );
}
