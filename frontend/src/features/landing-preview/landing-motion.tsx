"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./landing-motion.module.css";
import widthStyles from "./landing-hero-width.module.css";

/** Progressive enhancement: content is visible before JS and without motion. */
export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const page = root.current;
    if (!page || typeof IntersectionObserver === "undefined" || !HTMLElement.prototype.animate) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;
    const animations = new Set<Animation>();
    const stop = () => { observer?.disconnect(); animations.forEach((animation) => animation.cancel()); animations.clear(); };
    const start = () => {
      stop();
      if (preference.matches) return;
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          const heading = target.tagName === "H2";
          const sequence = Number(target.dataset.motionOrder ?? 0);
          const animation = target.animate(heading
            ? [{ clipPath: "inset(0 0 100% 0)", transform: "translateY(12px)" }, { clipPath: "inset(0 0 0% 0)", transform: "translateY(0)" }]
            : [{ opacity: .25, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: heading ? 650 : 550, delay: sequence * 65, easing: "cubic-bezier(.16,1,.3,1)" });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
          observer?.unobserve(target);
        }
      }, { threshold: .15 });
      page.querySelectorAll<HTMLElement>('#how-it-works h2, #audience h2, #platform h2, #brands h2, #value h2, [data-landing-preview-part="FinalCta"]').forEach((target) => observer?.observe(target));
      page.querySelectorAll<HTMLElement>('#landing-preview-title > span').forEach((target,index) => {
        const animation = target.animate([{clipPath:'inset(0 0 100% 0)',transform:'translateY(18px)'},{clipPath:'inset(0 0 0% 0)',transform:'translateY(0)'}],{duration:750,delay:index*140,easing:'cubic-bezier(.16,1,.3,1)'});
        animations.add(animation);
        animation.onfinish=()=>animations.delete(animation);
      });
      for (const selector of ['#how-it-works ol > li', '#audience article', '#platform article']) {
        page.querySelectorAll<HTMLElement>(selector).forEach((target, index) => {
          target.dataset.motionOrder = String(index);
          observer?.observe(target);
        });
      }
    };
    start();
    preference.addEventListener("change", start);
    return () => { stop(); preference.removeEventListener("change", start); };
  }, []);
  return <main ref={root} className={`${widthStyles.page} ${styles.page} flex flex-col overflow-x-hidden bg-brand-plaster`}>{children}</main>;
}
