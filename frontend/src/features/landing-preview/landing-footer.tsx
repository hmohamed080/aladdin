"use client";

import Image from "next/image";
import { HelpIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent } from "./landing-block-content";
import styles from "./landing-footer.module.css";

export function LandingFooter() {
  const { locale } = useI18n();
  const t = landingBlockContent[locale];
  const columns = [
    { title: t.quickLinks, links: [[t.how, "#how-it-works"], [t.rolesTitle, "#audience"], [t.videos, "#platform"], [t.brands, "#brands"]] },
    { title: t.account, links: [[t.register, "/auth/sign-up"], [t.signIn, "/auth/sign-in"], [t.privacy, "/legal/privacy"], [t.terms, "/legal/terms"]] },
  ];
  return (
    <footer className={styles.footer} data-landing-preview-part="Footer">
      <div className={styles.columns}>
        <div className={styles.brand}>
          <Image src="/preview/landing/aladdin-logo.png" alt="Aladdin" width={684} height={643} className={styles.logo} />
          <p>{t.footerDescription}</p>
        </div>
        {columns.map((column) => <nav key={column.title} aria-label={column.title}>
          <h3>{column.title}</h3>
          <ul>{column.links.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}</ul>
        </nav>)}
        <div className={styles.support}>
          <h3>{t.support}</h3>
          <p>{t.supportText}</p>
          <a href="/auth/support"><HelpIcon size={16} />{t.help}</a>
        </div>
      </div>
      <p className={styles.copyright}>{t.copyright}</p>
    </footer>
  );
}
