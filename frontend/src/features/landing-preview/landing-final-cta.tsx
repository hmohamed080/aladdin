"use client";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import { MailIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent } from "./landing-block-content";
import styles from "./landing-final-cta.module.css";

export function LandingFinalCta() {
  const { locale } = useI18n();
  const t = landingBlockContent[locale];
  return (
    <section className={styles.banner} data-landing-preview-part="FinalCta" aria-labelledby="join-heading">
      <div className={styles.visual} aria-hidden="true">
        <Image src="/preview/landing/sections/products-scene.png" alt="" fill sizes="30vw" className={styles.image} />
      </div>
      <div className={styles.copy}>
        <h2 id="join-heading">{t.cta}</h2>
        <p>{t.ctaText}</p>
        <div className={styles.actions}>
          <ButtonLink href="/auth/sign-up" variant="accent" size="sm"><UserIcon size={18} />{t.register}</ButtonLink>
          <ButtonLink href="/auth/support" variant="outline" size="sm" className={styles.contact}><MailIcon size={18} />{t.contact}</ButtonLink>
        </div>
      </div>
    </section>
  );
}
