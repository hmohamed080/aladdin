import Image from "next/image";
import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import type { TranslateFn } from "@/lib/i18n/translate";
import { CRAFTSMAN_AUTH_ASSETS, type CraftsmanAsset } from "./assets";
import styles from "./craftsman-auth.module.css";

type Variant = "signUp" | "signIn";
type IconKey = keyof typeof CRAFTSMAN_AUTH_ASSETS.icons;

const FEATURES: Record<Variant, { icon: IconKey; title: string; body: string }[]> = {
  signUp: [
    { icon: "briefcase", title: "realJobsTitle", body: "realJobsBody" },
    { icon: "people", title: "networkTitle", body: "networkBody" },
    { icon: "chart", title: "skillsTitle", body: "skillsBody" },
  ],
  signIn: [
    { icon: "briefcase", title: "followJobsTitle", body: "followJobsBody" },
    { icon: "bell", title: "updatesTitle", body: "updatesBody" },
    { icon: "people", title: "connectTitle", body: "connectBody" },
  ],
};

/**
 * The Aladdin lockup for these pages: the approved emblem (shared `Brand`,
 * emblem only) beside the name in the UI face at a normal line height — the
 * shared wordmark is set `leading-none` in the display face, which clips Arabic
 * marks at this size.
 */
function CraftsmanBrand({ name }: { name: string }) {
  return (
    <span className={styles.brand}>
      <Brand name={name} wordmark={false} size="lg" />
      <span className={styles.brandName}>{name}</span>
    </span>
  );
}

function FeatureTile({ asset }: { asset: CraftsmanAsset }) {
  return (
    <span aria-hidden="true" className={styles.featureTile}>
      <Image src={asset.src} alt="" width={asset.width} height={asset.height} sizes="76px" />
    </span>
  );
}

/**
 * Full-screen shell for the installer phone + password auth pages — no navbar, no
 * footer. Composition and breakpoints live in `craftsman-auth.module.css`;
 * imagery comes from the approved assets in `assets.ts`.
 */
export function CraftsmanAuthShell({
  variant,
  t,
  title,
  mobileTitle,
  subtitle,
  footer,
  children,
}: {
  variant: Variant;
  t: TranslateFn;
  title: string;
  /** Heading on the mobile composition when it differs from the card's (sign-in: "welcome back"). */
  mobileTitle?: string;
  subtitle: string;
  footer: { prompt: string; linkLabel: string; href: string };
  children: ReactNode;
}) {
  const hero =
    variant === "signUp"
      ? { lead: "signUpTitleLead", accent: "signUpTitleAccent", body: "signUpBody" }
      : { lead: "signInTitleLead", accent: "signInTitleAccent", body: "signInBody" };
  const { worksiteHero, icons } = CRAFTSMAN_AUTH_ASSETS;
  const mobileArt = variant === "signUp" ? CRAFTSMAN_AUTH_ASSETS.craftsmanSignUp : CRAFTSMAN_AUTH_ASSETS.craftsmanSignIn;
  const appName = t("common.appName");

  return (
    <div dir="rtl" lang="ar" className={styles.stage}>
      <div aria-hidden="true" className={styles.backdrop}>
        <Image src={worksiteHero.src} alt="" fill priority sizes="100vw" />
      </div>
      <div aria-hidden="true" className={styles.veil} />

      <main className={styles.content}>
        {/* Mobile intro: logo + supplied illustration, above the form sheet. */}
        <div className={styles.mobileHeader}>
          <CraftsmanBrand name={appName} />
          <Image
            src={mobileArt.src}
            alt=""
            aria-hidden="true"
            width={mobileArt.width}
            height={mobileArt.height}
            sizes="300px"
            priority
            className={styles.mobileArt}
          />
        </div>

        {/* The card — first in DOM order (the form is the page's purpose), inline start (right in RTL). */}
        <div className={styles.cardColumn}>
          <section aria-labelledby="craftsman-auth-title" className={styles.card}>
            <header className={styles.cardHeader}>
              <h1 id="craftsman-auth-title" className={styles.cardTitle}>
                {mobileTitle && mobileTitle !== title ? (
                  <>
                    <span className={styles.titleDesktop}>{title}</span>
                    <span className={styles.titleMobile}>{mobileTitle}</span>
                  </>
                ) : (
                  title
                )}
              </h1>
              <p className={styles.cardSubtitle}>{subtitle}</p>
            </header>

            {children}

            <p className="text-center text-body-lg text-fg-secondary">
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

        {/* Headline + benefits — desktop, inline end (left in RTL), over the artwork's sky. */}
        <aside className={styles.hero}>
          <h2 className={styles.headline}>
            <span className={styles.headlineLead}>{t(`temporaryCraftsman.hero.${hero.lead}`)}</span>
            <span className={styles.headlineAccent}>{t(`temporaryCraftsman.hero.${hero.accent}`)}</span>
          </h2>
          <p className={styles.lede}>{t(`temporaryCraftsman.hero.${hero.body}`)}</p>
          <span aria-hidden="true" className={styles.rule} />
          <ul className={styles.features}>
            {FEATURES[variant].map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <FeatureTile asset={icons[feature.icon]} />
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
