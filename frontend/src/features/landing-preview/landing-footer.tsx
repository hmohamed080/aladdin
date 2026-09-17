"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import styles from "./landing-footer.module.css";

const content = {
  ar: {
    tagline: "في التشطيبات.. كل الأطراف في منصة واحدة",
    columns: [
      { title: "المنصة", links: [["المنتجات", "/auth/sign-up"], ["الموردون", "/auth/sign-up"], ["المعارض", "/auth/sign-up"], ["كيف يعمل", "#how-it-works"]] },
      { title: "الحلول", links: [["للمقاولين", "/auth/sign-up"], ["للمهندسين", "/auth/sign-up"], ["للمصنّعين", "/auth/sign-up"], ["للموردين", "/auth/sign-up"]] },
      { title: "علاء الدين", links: [["من نحن", "/auth/sign-up"], ["المقالات", "/auth/sign-up"], ["تواصل معنا", "/auth/sign-up"]] },
    ],
    newsletterTitle: "اشترك في نشرتنا",
    newsletterText: "أحدث المنتجات والفرص مباشرة إلى بريدك",
    placeholder: "أدخل بريدك الإلكتروني",
    bottomLinks: [["الخصوصية", "/auth/sign-up"], ["الشروط", "/auth/sign-up"], ["المساعدة", "/auth/sign-up"]],
    copyright: "© علاء الدين. جميع الحقوق محفوظة.",
  },
  en: {
    tagline: "In finishing.. every side, one platform",
    columns: [
      { title: "Platform", links: [["Products", "/auth/sign-up"], ["Suppliers", "/auth/sign-up"], ["Showrooms", "/auth/sign-up"], ["How it works", "#how-it-works"]] },
      { title: "Solutions", links: [["For contractors", "/auth/sign-up"], ["For engineers", "/auth/sign-up"], ["For manufacturers", "/auth/sign-up"], ["For suppliers", "/auth/sign-up"]] },
      { title: "Aladdin", links: [["About us", "/auth/sign-up"], ["Articles", "/auth/sign-up"], ["Contact us", "/auth/sign-up"]] },
    ],
    newsletterTitle: "Subscribe to our newsletter",
    newsletterText: "The latest products and opportunities, straight to your inbox",
    placeholder: "Enter your email",
    bottomLinks: [["Privacy", "/auth/sign-up"], ["Terms", "/auth/sign-up"], ["Help", "/auth/sign-up"]],
    copyright: "© Aladdin. All rights reserved.",
  },
} as const;

function LinkedInGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.83v1.64h.05c.53-1 1.85-2.06 3.8-2.06 4.07 0 4.82 2.68 4.82 6.16V21h-4v-5.6c0-1.34-.02-3.06-1.87-3.06-1.87 0-2.16 1.46-2.16 2.96V21h-4V9Z" />
    </svg>
  );
}

function InstagramGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function YouTubeGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 12s0-3.2-.4-4.7a2.9 2.9 0 0 0-2-2.1C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.6.4a2.9 2.9 0 0 0-2 2.1C2 8.8 2 12 2 12s0 3.2.4 4.7c.2 1 1 1.8 2 2.1 1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4a2.9 2.9 0 0 0 2-2.1C22 15.2 22 12 22 12ZM10 15.3V8.7L15.8 12 10 15.3Z" />
    </svg>
  );
}

export function LandingFooter() {
  const { locale, dir } = useI18n();
  const copy = content[locale];
  const [subscribed, setSubscribed] = useState(false);
  // A fixed id, not `useId()` — there is exactly one footer/newsletter form
  // on this page, so there's no collision risk to guard against, and a
  // fixed string avoids the id depending on this component's exact position
  // in the render tree (which is what produced a real hydration mismatch
  // here — the id server-rendered didn't match the one React picked on the
  // client for the same node).
  const emailFieldId = "landing-preview-newsletter-email";

  // No backend/data-fetching change in this pass — this is a visual preview
  // only, so the form simply acknowledges the action locally.
  function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscribed(true);
  }

  return (
    <footer className={styles.footer} dir={dir} data-landing-preview-part="Footer">
      <div className={styles.texture} aria-hidden="true">
        <Image src="/preview/landing/sections/footer-texture.png" alt="" fill sizes="100vw" className={styles.textureImg} />
      </div>

      {/* `.top`'s own CSS pins `direction: ltr` so the three blocks below
          keep the SAME physical arrangement as the reference (logo left,
          link columns middle, newsletter right) regardless of locale — the
          reference draws one fixed layout, not a mirrored one. Each block
          gets its own `dir={dir}` back so ITS text still reads and aligns
          correctly per locale; only the grid's own left-to-right order is
          fixed. */}
      <div className={styles.top}>
        <div className={styles.brandBlock} dir={dir}>
          <Image src="/preview/landing/aladdin-logo.png" alt="Aladdin" width={684} height={643} className={styles.logo} />
          <p className={styles.tagline}>{copy.tagline}</p>
        </div>

        {/* No `dir` here — this grid must keep the SAME fixed left-to-right
            column order as `.top` (Platform, Solutions, Aladdin, matching
            the reference). `dir` moves down to each individual `.column`
            instead, so only that column's OWN text reads/aligns per locale,
            not which column comes first. */}
        <div className={styles.columns}>
          {copy.columns.map((col) => (
            <div key={col.title} className={styles.column} dir={dir}>
              <h3 className={styles.columnTitle}>{col.title}</h3>
              <ul className={styles.columnList}>
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className={styles.columnLink}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={styles.newsletter} dir={dir}>
          <h3 className={styles.newsletterTitle}>{copy.newsletterTitle}</h3>
          <p className={styles.newsletterText}>{copy.newsletterText}</p>
          <form className={styles.subscribeForm} onSubmit={handleSubscribe}>
            <label htmlFor={emailFieldId} className="sr-only">
              {copy.placeholder}
            </label>
            <input
              id={emailFieldId}
              type="email"
              required
              placeholder={copy.placeholder}
              className={styles.subscribeInput}
            />
            <button type="submit" className={styles.subscribeSubmit} aria-label={copy.newsletterTitle}>
              <ArrowUpRightIcon size={16} strokeWidth={2} />
            </button>
          </form>
          {subscribed ? <p className={styles.subscribedNote}>{locale === "ar" ? "تم الاشتراك، شكراً لك." : "Subscribed — thank you."}</p> : null}

          <div className={styles.social}>
            <a href="https://linkedin.com" className={styles.socialLink} aria-label="LinkedIn">
              <LinkedInGlyph />
            </a>
            <a href="https://instagram.com" className={styles.socialLink} aria-label="Instagram">
              <InstagramGlyph />
            </a>
            <a href="https://youtube.com" className={styles.socialLink} aria-label="YouTube">
              <YouTubeGlyph />
            </a>
          </div>
        </div>
      </div>

      <div className={styles.bottom} dir="ltr">
        <p className={styles.copyright} dir={dir}>
          {copy.copyright}
        </p>
        <ul className={styles.bottomLinks} dir={dir}>
          {copy.bottomLinks.map(([label, href]) => (
            <li key={label}>
              <a href={href} className={styles.bottomLink}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
