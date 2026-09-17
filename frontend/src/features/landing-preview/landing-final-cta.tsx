"use client";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-final-cta.module.css";

const content = {
  ar: {
    title: "ابدأ رحلتك مع علاء الدين اليوم",
    subtitle: "انضم إلى المنصة واربط أعمالك بفرص أكبر",
    primary: "إنشاء حساب",
    secondary: "تسجيل الدخول",
  },
  en: {
    title: "Start your journey with Aladdin today",
    subtitle: "Join the platform and connect your business to bigger opportunities",
    primary: "Create account",
    secondary: "Sign in",
  },
} as const;

export function LandingFinalCta() {
  const { locale, dir } = useI18n();
  const copy = content[locale];

  const secondaryButton = (
    <ButtonLink href="/auth/sign-in" variant="outline" size="sm" className={`${styles.secondaryCta} rounded-pill`}>
      {copy.secondary}
    </ButtonLink>
  );
  const primaryButton = (
    <ButtonLink href="/auth/sign-up" variant="accent" size="sm" className={`${styles.primaryCta} rounded-pill`}>
      <span>{copy.primary}</span>
      <span className={styles.ctaIcon}>
        <ArrowUpRightIcon size={14} strokeWidth={2} />
      </span>
    </ButtonLink>
  );

  return (
    <section className={styles.section} data-landing-preview-part="FinalCta">
      <div className={styles.scene}>
        <Image
          src="/preview/landing/sections/final-cta-scene.png"
          alt=""
          fill
          sizes="100vw"
          className={styles.sceneImg}
        />
      </div>

      <Reveal direction="end" className={styles.copyWrap}>
        <div className={styles.copy} dir={dir}>
          <h2 className={styles.title}>{copy.title}</h2>
          <p className={styles.subtitle}>{copy.subtitle}</p>
          {/* `.actions` is a flex row with no `direction` override, so under
              `dir="rtl"` its own main axis (and therefore which DOM child
              lands physically left vs. right) flips — the same
              logical-vs-physical trap fixed elsewhere on this page, just
              resolved here by swapping render order instead of pinning
              `direction: ltr`, since pinning it would also flip each
              button's own (intentionally RTL-relative) icon placement. The
              reference always shows the outline button physically left of
              the gold one, so which button renders first is chosen to land
              there under each direction's own start-to-end order. */}
          <div className={styles.actions}>
            {dir === "rtl" ? (
              <>
                {primaryButton}
                {secondaryButton}
              </>
            ) : (
              <>
                {secondaryButton}
                {primaryButton}
              </>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
