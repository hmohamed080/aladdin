import Image from "next/image";
import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import type { TranslateFn } from "@/lib/i18n/translate";
import { CRAFTSMAN_AUTH_ASSETS } from "./assets";
import { BellIcon, BriefcaseIcon, ChartIcon, ShieldCheckIcon, UsersIcon, WrenchIcon } from "./icons";
import styles from "./craftsman-auth.module.css";

type Variant = "signUp" | "signIn";

const FEATURES: Record<Variant, { icon: ReactNode; title: string; body: string }[]> = {
  signUp: [
    { icon: <BriefcaseIcon width={26} height={26} />, title: "realJobsTitle", body: "realJobsBody" },
    { icon: <UsersIcon width={26} height={26} />, title: "networkTitle", body: "networkBody" },
    { icon: <ChartIcon width={26} height={26} />, title: "skillsTitle", body: "skillsBody" },
  ],
  signIn: [
    { icon: <BriefcaseIcon width={26} height={26} />, title: "followJobsTitle", body: "followJobsBody" },
    { icon: <BellIcon width={26} height={26} />, title: "updatesTitle", body: "updatesBody" },
    { icon: <UsersIcon width={26} height={26} />, title: "connectTitle", body: "connectBody" },
  ],
};

/**
 * The Aladdin lockup for these pages: the approved emblem (shared `Brand`,
 * emblem only) beside the name set in the UI face at a normal line height.
 * The shared wordmark uses the display face at `leading-none`, which clips
 * Arabic dots at this size — so it is not used here.
 */
function CraftsmanBrand({ name }: { name: string }) {
  return (
    <span className={styles.brand}>
      <Brand name={name} wordmark={false} size="lg" />
      <span className={styles.brandName}>{name}</span>
    </span>
  );
}

/**
 * Full-screen shell for the TEMPORARY craftsman auth pages — no navbar, no
 * footer. Composition and breakpoints live in `craftsman-auth.module.css`;
 * imagery comes from the replaceable slots in `assets.ts`.
 */
export function CraftsmanAuthShell({
  variant,
  t,
  title,
  subtitle,
  footer,
  children,
}: {
  variant: Variant;
  t: TranslateFn;
  title: string;
  subtitle: string;
  footer: { prompt: string; linkLabel: string; href: string };
  children: ReactNode;
}) {
  const hero =
    variant === "signUp"
      ? { lead: "signUpTitleLead", accent: "signUpTitleAccent", body: "signUpBody" }
      : { lead: "signInTitleLead", accent: "signInTitleAccent", body: "signInBody" };
  const { worksiteBackground, craftsman } = CRAFTSMAN_AUTH_ASSETS;
  const appName = t("common.appName");

  return (
    <div dir="rtl" lang="ar" className={styles.stage}>
      <div aria-hidden="true" className={styles.backdrop}>
        <Image src={worksiteBackground.src} alt="" fill priority sizes="100vw" />
      </div>
      <div aria-hidden="true" className={styles.veil} />
      <span aria-hidden="true" className={`${styles.band} ${styles.bandNavyTop}`} />
      <span aria-hidden="true" className={`${styles.band} ${styles.bandLapisTop}`} />
      <span aria-hidden="true" className={`${styles.band} ${styles.bandLapisLow}`} />
      <span aria-hidden="true" className={`${styles.band} ${styles.bandLumenBottom}`} />
      <span aria-hidden="true" className={`${styles.band} ${styles.bandLapisBottom}`} />

      <main className={styles.content}>
        <div className={styles.tabletBrand}>
          <CraftsmanBrand name={appName} />
        </div>

        {/* Mobile: illustrated header above the form sheet. */}
        <div className={styles.mobileHeader}>
          <span aria-hidden="true" className={styles.mobileBandLapis} />
          <span aria-hidden="true" className={styles.mobileBandLumen} />
          <CraftsmanBrand name={appName} />
          <div aria-hidden="true" className={styles.halo}>
            <Image src={craftsman.src} alt="" width={craftsman.width} height={craftsman.height} priority />
          </div>
          <span aria-hidden="true" className={`${styles.haloBadge} ${styles.haloBadgeStart}`}>
            <WrenchIcon width={22} height={22} />
          </span>
          <span aria-hidden="true" className={`${styles.haloBadge} ${styles.haloBadgeEnd}`}>
            <ShieldCheckIcon width={22} height={22} />
          </span>
        </div>

        {/* The card — first in DOM order (the form is the page's purpose), inline start (right in RTL). */}
        <div className={styles.cardColumn}>
          <section aria-labelledby="craftsman-auth-title" className={styles.card}>
            <header className={styles.cardHeader}>
              <h1 id="craftsman-auth-title" className={styles.cardTitle}>
                {title}
              </h1>
              <p className={styles.cardSubtitle}>{subtitle}</p>
            </header>

            {children}

            <p className="text-center text-body text-fg-secondary">
              {footer.prompt}{" "}
              <Link
                href={footer.href}
                className="font-semibold text-brand-lapis underline underline-offset-4 hover:opacity-80 dark:text-brand-lapis-bright"
              >
                {footer.linkLabel}
              </Link>
            </p>
          </section>
        </div>

        {/* The craftsman, standing on the bottom edge between the card and the headline. */}
        <div aria-hidden="true" className={styles.figureColumn}>
          <div className={styles.figure}>
            <Image src={craftsman.src} alt="" width={craftsman.width} height={craftsman.height} priority />
          </div>
        </div>

        {/* Headline + benefits — desktop, inline end (left in RTL). */}
        <aside className={styles.hero}>
          <CraftsmanBrand name={appName} />
          <h2 className={styles.headline}>
            <span className={styles.headlineLead}>{t(`temporaryCraftsman.hero.${hero.lead}`)}</span>
            <span className={styles.headlineAccent}>{t(`temporaryCraftsman.hero.${hero.accent}`)}</span>
          </h2>
          <p className={styles.lede}>{t(`temporaryCraftsman.hero.${hero.body}`)}</p>
          <span aria-hidden="true" className={styles.rule} />
          <ul className={styles.features}>
            {FEATURES[variant].map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <span aria-hidden="true" className={styles.featureIcon}>
                  {feature.icon}
                </span>
                <span>
                  <span className={styles.featureTitle}>{t(`temporaryCraftsman.features.${feature.title}`)}</span>
                  <span className={styles.featureBody}>{t(`temporaryCraftsman.features.${feature.body}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
