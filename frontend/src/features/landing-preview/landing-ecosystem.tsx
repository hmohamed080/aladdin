"use client";

import Image from "next/image";
import { useState } from "react";
import { CheckIcon, PlayIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent, landingLogos } from "./landing-block-content";
import { LandingFinalCta } from "./landing-final-cta";
import { LandingFooter } from "./landing-footer";
import { LandingStories } from "./landing-stories";
import { LandingDetails, type LandingDetail } from "./landing-details";
import styles from "./landing-ecosystem.module.css";

function RoleIllustration({ index, small = false }: { index: number; small?: boolean }) {
  return <span aria-hidden="true" className={`${styles.illustration} ${small ? styles.smallIllustration : ""}`}
    style={{ backgroundPosition: `${(index % 3) * 50}% ${index < 3 ? 0 : 100}%` }} />;
}

/** The reference's complete post-hero composition, scoped to the preview. */
export function LandingEcosystem() {
  const { locale, dir } = useI18n();
  const t = landingBlockContent[locale];
  const [detail, setDetail] = useState<LandingDetail | null>(null);
  return (
    <div className={styles.block} dir={dir} data-landing-preview-part="Ecosystem">
      <div className={styles.container}>
        <section id="how-it-works" className={styles.process} aria-labelledby="process-heading">
          <h2 id="process-heading" className={styles.heading}>{t.how}</h2>
          <ol className={styles.flow}>
            {t.flow.map((item, index) => {
              return (
                <li key={item.title}>
                  <RoleIllustration index={index} />
                  <h3>{item.title}</h3><p>{item.text}</p>
                  {index < t.flow.length - 1 && <span className={styles.flowArrow} aria-hidden="true">→</span>}
                </li>
              );
            })}
          </ol>
        </section>
        <section id="audience" className={styles.rolesSection} aria-labelledby="roles-heading">
          <h2 id="roles-heading" className={styles.heading}>{t.rolesTitle}</h2>
          <div className={styles.roles}>
            {t.roles.map((role, index) => {
              return (
                <article key={role.title} className={styles.roleCard}>
                  <div className={styles.roleHeading}><RoleIllustration index={index} small /><h3>{role.title}</h3></div>
                  <ul>{role.bullets.map((bullet) => <li key={bullet}><CheckIcon aria-hidden="true" /><span>{bullet}</span></li>)}</ul>
                  <button type="button" className={styles.roleCta} onClick={() => setDetail(index)}>{t.learn}</button>
                </article>
              );
            })}
          </div>
        </section>
        <section id="platform" className={styles.videosSection} aria-labelledby="videos-heading">
          <div className={styles.sectionHeading}>
            <h2 id="videos-heading" className={styles.heading}>{t.videos}</h2>
            <button type="button" className={styles.secondaryAction} onClick={() => setDetail("videos")}>{t.videoAction}</button>
          </div>
          <div className={styles.videos}>
            {t.videoCategories.map((category) => (
              <article key={category} className={styles.videoCard} data-content-slot="video">
                <div className={styles.thumbnail}>
                  <span className={styles.category}>{category}</span>
                  <span className={styles.play} aria-hidden="true"><PlayIcon /></span>
                  <span className={styles.duration} aria-label={t.durationPending}>—:—</span>
                </div>
                <h3>{t.videoPending}</h3><p>{t.videoDescription}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="brands" className={styles.brandsSection} aria-labelledby="brands-heading">
          <div className={`${styles.sectionHeading} ${styles.brandHeading}`}>
            <h2 id="brands-heading" className={styles.heading}>{t.brands}</h2>
            <button type="button" className={styles.secondaryAction} onClick={() => setDetail("partners")}>{t.partnerAction}</button>
          </div>
          <ul className={styles.logoStrip}>
            {landingLogos.map(({ file, name }) => (
              <li key={file} data-logo={file}><Image src={`/preview/landing/partners/${file}`} alt={name} width={180} height={110} sizes="(max-width: 767px) 28vw, 10vw" /></li>
            ))}
          </ul>
        </section>
        <section id="value" className={styles.storiesSection} aria-labelledby="stories-heading">
          <h2 id="stories-heading" className={styles.heading}>{t.stories}</h2>
          <LandingStories />
        </section>
        <LandingFinalCta />
      </div>
      <LandingFooter />
      <LandingDetails detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
