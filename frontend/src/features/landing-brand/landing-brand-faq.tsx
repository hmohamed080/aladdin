"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { brandContent } from "./landing-brand-content";
import styles from "./landing-brand.module.css";

export function LandingBrandFaq() {
  const { locale } = useI18n();
  const [open, setOpen] = useState(-1);
  return (
    <div className={styles.faqList}>
      {brandContent[locale].faq.items.map(([q, a], i) => (
        <div key={q} className={styles.faqItem}>
          <button type="button" id={`faq-q-${i}`} aria-expanded={open === i} aria-controls={`faq-a-${i}`} onClick={() => setOpen(open === i ? -1 : i)}>
            <span>{q}</span><span aria-hidden="true">{open === i ? "−" : "+"}</span>
          </button>
          {open === i ? <p id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`}>{a}</p> : null}
        </div>
      ))}
    </div>
  );
}
