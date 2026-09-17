"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { landingBlockContent } from "./landing-block-content";
import styles from "./landing-stories.module.css";

export type LandingTestimonial = {
  id: string; quote: string; name: string; role: string; portrait?: string;
};

// Supply only approved, consented testimonials. Empty groups are preview slots.
export function LandingStories({ testimonials = [] }: { testimonials?: readonly LandingTestimonial[] }) {
  const { locale, dir } = useI18n();
  const t = landingBlockContent[locale];
  const [visible, setVisible] = useState(3);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const touchStart = useRef<number | null>(null);
  const count = testimonials.length ? Math.ceil(testimonials.length / visible) : 3;
  const current = active % count;

  useEffect(() => {
    const mobile = matchMedia("(max-width: 767px)");
    const tablet = matchMedia("(max-width: 1023px)");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setVisible(mobile.matches ? 1 : tablet.matches ? 2 : 3);
      setReduced(motion.matches);
    };
    update();
    [mobile, tablet, motion].forEach((query) => query.addEventListener("change", update));
    return () => [mobile, tablet, motion].forEach((query) => query.removeEventListener("change", update));
  }, []);

  useEffect(() => {
    if (paused || hovered || focused || reduced || count < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((value) => (value + 1) % count);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, hovered, focused, reduced, count]);

  return (
    <div className={styles.carousel} role="region" aria-roledescription={locale === "ar" ? "عارض شرائح" : "carousel"}
      aria-labelledby="stories-heading" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}>
      <div className={styles.viewport} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const end = event.changedTouches[0]?.clientX;
          if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 40) {
            const step = end < touchStart.current ? 1 : -1;
            setActive((current + step + count) % count);
            setPaused(true);
          }
          touchStart.current = null;
        }}>
        <div className={styles.track} style={{ transform: `translateX(-${current * 100}%)` }}>
          {Array.from({ length: count }, (_, group) => {
            const items: (LandingTestimonial | null)[] = testimonials.length
              ? testimonials.slice(group * visible, (group + 1) * visible)
              : Array.from({ length: visible }, () => null);
            return <div key={group} className={styles.group} dir={dir} role="group" aria-roledescription={locale === "ar" ? "شريحة" : "slide"}
              aria-label={`${group + 1} / ${count}`} aria-hidden={group !== current} inert={group !== current} data-active={group === current}>
              {items.map((item, slot) => <article key={item?.id ?? slot} className={styles.card} data-content-slot="testimonial">
                <div className={styles.quote}><span aria-hidden="true">“</span><p>{item?.quote ?? t.quotePending}</p></div>
                <div className={styles.author}>
                  {item?.portrait ? <Image src={item.portrait} alt="" width={48} height={48} className={styles.avatar} /> : <span className={styles.avatar} aria-hidden="true"><UserIcon /></span>}
                  <div><h3>{item?.name ?? t.namePending}</h3><p>{item?.role ?? t.rolePending}</p>
                    {!item && <small>{locale === "ar" ? "مساحة" : "Slot"} {group * visible + slot + 1}</small>}
                  </div>
                </div>
              </article>)}
            </div>;
          })}
        </div>
      </div>
      <div className={styles.controls}>
        <div className={styles.dots}>
          {Array.from({ length: count }, (_, group) => <button key={group} type="button" aria-label={`${locale === "ar" ? "عرض المجموعة" : "Show group"} ${group + 1}`}
            aria-current={group === current ? "true" : undefined} onClick={() => { setActive(group); setPaused(true); }}><span /></button>)}
        </div>
        {!reduced && count > 1 && <button type="button" className={styles.pause} onClick={() => setPaused(!paused)}>
          {locale === "ar" ? (paused ? "تشغيل تلقائي" : "إيقاف مؤقت") : (paused ? "Play slideshow" : "Pause slideshow")}
        </button>}
      </div>
    </div>
  );
}
