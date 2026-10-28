import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth-stage.module.css";

/**
 * The one sign-in / sign-up composition for the whole site (showroom, installer,
 * email + password, recovery): photo beside a cream sheet, `.installer-surface`
 * palette. `toolbar` (language / theme switchers) sits at the top of the sheet.
 */
export function AuthStage({
  dir = "rtl",
  lang = "ar",
  toolbar,
  labelledBy,
  children,
}: {
  dir?: "rtl" | "ltr";
  lang?: string;
  toolbar?: ReactNode;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <main className={`${styles.stage} installer-surface`} lang={lang}>
      <section className={styles.sheet} dir={dir} aria-labelledby={labelledBy}>
        {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
        <div className={styles.body}>
          <div className={`${styles.inner} ${styles.content}`}>{children}</div>
        </div>
      </section>
      <div className={styles.photo} aria-hidden="true">
        <picture>
          <source media="(max-width: 767px)" srcSet="/assets/showroom-auth/showroom-interior-mobile-2026.png" />
          <Image src="/assets/showroom-auth/showroom-interior-2026.png" alt="" fill loading="eager" fetchPriority="high" sizes="62vw" />
        </picture>
      </div>
    </main>
  );
}

/** Logo, optional account badge, title, subtitle and description, centred. */
export function AuthStageHeader({
  id,
  appName,
  badge,
  title,
  subtitle,
  description,
}: {
  id?: string;
  appName: string;
  badge?: ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Image src="/assets/showroom-auth/aladdin-logo-2026.png" alt={appName} width={1536} height={1024} priority className={styles.logo} />
      </div>
      {badge ? <p className={styles.badge}>{badge}</p> : null}
      <h1 id={id}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  );
}

/** "No account? Create one" line between two sand rules. */
export function AuthStageFooter({ prompt, linkLabel, href }: { prompt: string; linkLabel: string; href: string }) {
  return (
    <p className={styles.footer}>
      {prompt} <Link href={href}>{linkLabel}</Link>
    </p>
  );
}

/** Secondary links (forgot password, other sign-in methods) under the footer. */
export function AuthStageLinks({ children }: { children: ReactNode }) {
  return <div className={styles.links}>{children}</div>;
}
