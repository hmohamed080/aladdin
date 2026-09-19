"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/controls";
import { ArrowUpRightIcon, GlobeIcon, MenuIcon, XIcon } from "@/components/ui/icons";
import { LanguageSwitch } from "@/components/layout/switchers";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-header.module.css";

const content = {
  ar: {
    navigation: "التنقل الرئيسي", menu: "القائمة", signIn: "تسجيل الدخول", register: "إنشاء حساب",
    links: [["الرئيسية", "#landing-top"], ["عن المنصة", "#how-it-works"], ["المميزات", "#audience"], ["الشركاء", "#brands"], ["فيديوهات ومنتجات", "#platform"]],
    faq: "الأسئلة الشائعة", contact: "تواصل معنا",
    answers: [
      ["هل أحتاج حسابًا منفصلًا لكل شركة؟", "لا، يمكنك الوصول إلى الشركات التي تملكها أو تعمل بها من حسابك الشخصي نفسه."],
      ["هل إنشاء شركة مطلوب لكل مستخدم؟", "لا، يمكنك استخدام حسابك الشخصي كمحترف أو عميل دون إنشاء شركة."],
      ["كيف أسجّل الدخول؟", "باستخدام رمز تحقق أو رابط عبر وسيلة الاتصال المسجلة، دون كلمة مرور."],
    ],
  },
  en: {
    navigation: "Primary navigation", menu: "Menu", signIn: "Sign in", register: "Create account",
    links: [["Home", "#landing-top"], ["About", "#how-it-works"], ["Features", "#audience"], ["Partners", "#brands"], ["Videos & products", "#platform"]],
    faq: "FAQ", contact: "Contact us",
    answers: [
      ["Do I need a separate account for each business?", "No. Access the businesses you own or work with through the same personal account."],
      ["Does every user need to create a business?", "No. Professionals and customers can use a personal account without creating a business."],
      ["How do I sign in?", "Use a verification code or link sent to your registered contact method, without a password."],
    ],
  },
} as const;

export function LandingHeader() {
  const { locale, dir } = useI18n();
  const t = content[locale];
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const faq = useRef<HTMLDetailsElement>(null);
  return (
    <header className={styles.header} dir="ltr" data-landing-preview-part="Header" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      if (faq.current?.open) { faq.current.open = false; faq.current.querySelector("summary")?.focus(); }
      else if (open) { setOpen(false); menu.current?.focus(); }
    }}>
      <a className={styles.brand} href="#landing-top" aria-label="Aladdin">
        <Image src="/preview/landing/aladdin-logo.png" alt="" width={684} height={643} priority />
      </a>
      <Button ref={menu} className={styles.menu} variant="ghost" aria-label={t.menu} aria-expanded={open} aria-controls="preview-navigation" onClick={() => setOpen(!open)}>
        {open ? <XIcon size={20} /> : <MenuIcon size={20} />}<span>{t.menu}</span>
      </Button>
      <nav id="preview-navigation" className={styles.navigation} data-open={open} dir={dir} aria-label={t.navigation}>
        {t.links.map(([label, href], index) => <a key={href} href={href} className={index === 0 ? styles.home : undefined} onClick={() => setOpen(false)}>{label}</a>)}
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
        <ButtonLink href="/auth/sign-up" variant="accent" className={styles.register}>
          <span dir={dir}>{t.register}</span><span className={styles.arrow}><ArrowUpRightIcon size={16} aria-hidden="true" /></span>
        </ButtonLink>
      </div>
    </header>
  );
}
