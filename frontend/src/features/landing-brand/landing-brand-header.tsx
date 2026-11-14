"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";
import { brandContent } from "./landing-brand-content";
import { BrandIcon } from "./landing-brand-icons";
import styles from "./landing-brand.module.css";

/** Brand header: logo, anchor navigation, sign in, and the account-type dropdown (opens under its button). */
export function LandingBrandHeader() {
  const { dir, t: tr } = useI18n();
  const t = brandContent.nav;
  const [menuOpen, setMenuOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!signupOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setSignupOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [signupOpen]);

  return (
    <header
      className={styles.header}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (signupOpen) { setSignupOpen(false); trigger.current?.focus(); }
        else setMenuOpen(false);
      }}
    >
      <a className={styles.brand} href="#top" aria-label="Aladdin | علاء الدين">
        <Image src="/landing-brand/mark-cream.png" alt="" width={34} height={52} sizes="34px" priority />
        <span>علاء الدين</span>
      </a>
      <button type="button" className={styles.burger} aria-label={t.menu} aria-expanded={menuOpen} aria-controls="brand-nav" onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? <XIcon size={22} /> : <MenuIcon size={22} />}
      </button>
      <nav id="brand-nav" className={styles.nav} data-open={menuOpen} aria-label={t.label}>
        {t.items.map(([label, href], i) => (
          <a key={label} href={href} className={i === 0 ? styles.navActive : undefined} aria-current={i === 0 ? "page" : undefined} onClick={() => setMenuOpen(false)}>{label}</a>
        ))}
      </nav>
      <div className={styles.actions}>
        <div className={styles.registerWrap} ref={wrap}>
          <button ref={trigger} type="button" className={styles.register} aria-haspopup="true" aria-expanded={signupOpen} aria-controls="brand-register" onClick={() => setSignupOpen(!signupOpen)}>
            <BrandIcon name="user-plus" size={18} /><span>{t.register}</span>
          </button>
          {signupOpen ? (
            <div id="brand-register" className={styles.registerMenu} dir={dir} role="group" aria-label={t.registerTitle}>
              <p className={styles.registerTitle}>{t.registerTitle}</p>
              <ul>
                {REGISTRATION_CHOICE_ORDER.map((key) => {
                  const soon = CHOICES_BY_KEY[key]?.comingSoon === true;
                  const label = tr(`onboarding.accountType.types.${key}`);
                  const desc = tr(`onboarding.accountType.types.${key}Desc`);
                  return (
                    <li key={key}>
                      {soon ? (
                        <span className={`${styles.registerItem} ${styles.registerSoon}`} aria-disabled="true">
                          <span className={styles.registerLabel}>{label}<small>{t.soon}</small></span>
                          <span className={styles.registerDesc}>{desc}</span>
                        </span>
                      ) : (
                        <a className={styles.registerItem} href={`/auth/sign-up?type=${key}`} onClick={() => setSignupOpen(false)}>
                          <span className={styles.registerLabel}>{label}</span>
                          <span className={styles.registerDesc}>{desc}</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
        <a className={styles.signIn} href="/auth/sign-in">{t.signIn}</a>
      </div>
    </header>
  );
}
