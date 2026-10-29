"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/controls";
import { ArrowUpRightIcon, GlobeIcon, MenuIcon, XIcon } from "@/components/ui/icons";
import { LanguageSwitch } from "@/components/layout/switchers";
import { useI18n } from "@/lib/i18n/context";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";
import styles from "./landing-header.module.css";

const content = {
  ar: {
    navigation: "التنقل الرئيسي", menu: "القائمة", signIn: "تسجيل الدخول", register: "إنشاء حساب", registerTitle: "اختر نوع حسابك", soon: "قريبًا", marketplace: "السوق",
    links: [["الرئيسية", "#landing-top"], ["عن المنصة", "#how-it-works"], ["المميزات", "#audience"], ["الشركاء", "#brands"], ["فيديوهات ومنتجات", "#platform"]],
    faq: "الأسئلة الشائعة", contact: "تواصل معنا",
    answers: [
      ["هل أحتاج حسابًا منفصلًا لكل شركة؟", "لا، يمكنك الوصول إلى الشركات التي تملكها أو تعمل بها من حسابك الشخصي نفسه."],
      ["هل إنشاء شركة مطلوب لكل مستخدم؟", "لا، يمكنك استخدام حسابك الشخصي كمحترف أو عميل دون إنشاء شركة."],
      ["كيف أسجّل الدخول؟", "باستخدام رمز تحقق أو رابط عبر وسيلة الاتصال المسجلة، دون كلمة مرور."],
    ],
  },
  en: {
    navigation: "Primary navigation", menu: "Menu", signIn: "Sign in", register: "Create account", registerTitle: "Choose your account type", soon: "Coming soon", marketplace: "Marketplace",
    links: [["Home", "#landing-top"], ["About", "#how-it-works"], ["Features", "#audience"], ["Partners", "#brands"], ["Videos & products", "#platform"]],
    faq: "FAQ", contact: "Contact us",
    answers: [
      ["Do I need a separate account for each business?", "No. Access the businesses you own or work with through the same personal account."],
      ["Does every user need to create a business?", "No. Professionals and customers can use a personal account without creating a business."],
      ["How do I sign in?", "Use a verification code or link sent to your registered contact method, without a password."],
    ],
  },
} as const;

/**
 * `anchorBase` lets other pages (e.g. the /marketplace coming-soon page) reuse the
 * same navigation: the in-page anchors become `/#section` links back to the home page.
 */
export function LandingHeader({ anchorBase = "", active = "home" }: { anchorBase?: string; active?: "home" | "marketplace" } = {}) {
  const { locale, dir, t: tr } = useI18n();
  const t = content[locale];
  // The Marketplace link opens the coming-soon page until the Marketplace ships; absolute paths are never prefixed.
  const links: [string, string][] = t.links.map(([label, href]) => [label, href]);
  links.splice(1, 0, [t.marketplace, "/marketplace"]);
  const [open, setOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const signup = useRef<HTMLDivElement>(null);
  const registerButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!signupOpen) return;
    const close = (event: MouseEvent) => {
      if (!signup.current?.contains(event.target as Node)) setSignupOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [signupOpen]);
  const faq = useRef<HTMLDetailsElement>(null);
  return (
    <header className={styles.header} dir="ltr" data-landing-preview-part="Header" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      if (signupOpen) { setSignupOpen(false); registerButton.current?.focus(); }
      else if (faq.current?.open) { faq.current.open = false; faq.current.querySelector("summary")?.focus(); }
      else if (open) { setOpen(false); menu.current?.focus(); }
    }}>
      <a className={styles.brand} href={`${anchorBase}#landing-top`} aria-label="Aladdin">
        {/* Drawn at most 80x72 CSS px (`.brand img`), so `sizes` lets the browser pick a small file instead of the
            1920 px one. No `priority`: the hero image, not the logo, is the LCP element. */}
        <Image src="/preview/landing/aladdin-logo-2026.png" alt="" width={720} height={773} sizes="80px" />
      </a>
      <Button ref={menu} className={styles.menu} variant="ghost" aria-label={t.menu} aria-expanded={open} aria-controls="preview-navigation" onClick={() => setOpen(!open)}>
        {open ? <XIcon size={20} /> : <MenuIcon size={20} />}<span>{t.menu}</span>
      </Button>
      <nav id="preview-navigation" className={styles.navigation} data-open={open} dir={dir} aria-label={t.navigation}>
        {links.map(([label, href]) => {
          const isActive = href === "/marketplace" ? active === "marketplace" : active === "home" && href === "#landing-top";
          return <a key={href} href={href.startsWith("/") ? href : `${anchorBase}${href}`} className={isActive ? styles.home : undefined} aria-current={isActive ? "page" : undefined} onClick={() => setOpen(false)}>{label}</a>;
        })}
        <details ref={faq} className={styles.faq}>
          <summary>{t.faq}</summary>
          <div className={styles.answers}>
            {t.answers.map(([question, answer]) => <div key={question}><h3>{question}</h3><p>{answer}</p></div>)}
          </div>
        </details>
        <a href="/auth/support">{t.contact}</a>
      </nav>
      <div className={styles.actions}>
        <span className={styles.language}><LanguageSwitch /><GlobeIcon size={14} aria-hidden="true" /></span>
        <a className={styles.signIn} href="/auth/sign-in" dir={dir}>{t.signIn}</a>
        <div className={styles.registerWrap} ref={signup}>
          <Button ref={registerButton} variant="accent" className={styles.register} aria-haspopup="true" aria-expanded={signupOpen} aria-controls="register-menu" onClick={() => setSignupOpen(!signupOpen)}>
            <span dir={dir}>{t.register}</span><span className={styles.arrow}><ArrowUpRightIcon size={16} aria-hidden="true" /></span>
          </Button>
          {signupOpen ? (
            <div id="register-menu" className={styles.registerMenu} dir={dir} role="group" aria-label={t.registerTitle}>
              <p className={styles.registerTitle}>{t.registerTitle}</p>
              <ul>
                {REGISTRATION_CHOICE_ORDER.map((key) => {
                  const soon = CHOICES_BY_KEY[key]?.comingSoon === true;
                  const label = tr(`onboarding.accountType.types.${key}`);
                  const desc = tr(`onboarding.accountType.types.${key}Desc`);
                  const href = `/auth/sign-up?type=${key}`;
                  return (
                    <li key={key}>
                      {soon ? (
                        <span className={`${styles.registerItem} ${styles.registerItemSoon}`} aria-disabled="true">
                          <span className={styles.registerLabel}>{label}<small className={styles.soon}>{t.soon}</small></span>
                          <span className={styles.registerDesc}>{desc}</span>
                        </span>
                      ) : (
                        <a className={styles.registerItem} href={href} onClick={() => setSignupOpen(false)}>
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
      </div>
    </header>
  );
}
