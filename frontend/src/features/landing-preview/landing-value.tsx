"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/context";
import { ClockIcon, HandshakeIcon, ShieldIcon } from "@/components/ui/icons";
import styles from "./landing-value.module.css";

/**
 * `section-3.png` is a plain decorative background now (marble/plant
 * accents at the edges, no baked columns, icons, or text of its own in
 * either language) — unlike the earlier version of this asset, so there is
 * nothing left for Arabic to rely on being "already drawn". Both locales
 * now render the same real HTML copy over it, in the same three-column
 * slots, each with its own icon per the approved reference.
 */
// Physical left-to-right order per the approved reference: Shield (trusted
// environment), Handshake (direct communication), Clock (save time) — the
// row's own `.overlay` ancestor is pinned `direction: ltr` (see below), so
// this DOM order is also the rendered physical order at every locale.
const items = [
  {
    icon: ShieldIcon,
    ar: { title: "بيئة موثوقة للمحترفين الحقيقيين", text: "موردون وشركات معتمدون ومنتجات موثوقة ومعلومات دقيقة" },
    en: { title: "A trusted environment for real professionals", text: "Verified suppliers and companies, trusted products, accurate information" },
  },
  {
    icon: HandshakeIcon,
    ar: { title: "تواصل مباشر وسهل", text: "تواصل مع الموردين والمعارض مباشرة وبدون وسيط" },
    en: { title: "Direct, easy communication", text: "Connect with suppliers and showrooms directly, no middleman" },
  },
  {
    icon: ClockIcon,
    ar: { title: "وفر وقتك وجهدك", text: "كل ما تحتاجه لمشاريعك في منصة واحدة" },
    en: { title: "Save your time and effort", text: "Everything you need for your projects, in one platform" },
  },
] as const;

export function LandingValue() {
  const { locale } = useI18n();
  const isArabic = locale === "ar";

  return (
    <section id="value" className={styles.section} data-landing-preview-part="ValueBand">
      <div className={styles.frame}>
        <Image
          src="/preview/landing/sections/value-band.png"
          alt=""
          fill
          sizes="100vw"
          className={styles.sceneImg}
        />
      </div>

      {/* A sibling of `.frame`, not a child — `.frame` keeps `overflow:
          hidden` and a fixed aspect-ratio at every width (it's just the
          image), so anything that needs to grow past that height at mobile
          can't live inside it. As a sibling of `.section` instead, this
          overlay can be absolutely positioned over the image on
          desktop/tablet and become a real static block stacked below it on
          mobile, without fighting the image's own clipped box.

          Fixed physical layout — the same three-column slot positions are
          used for both locales, so this overlay grid doesn't move between
          them. Both AR and EN render the same visible list now (the asset
          has no baked text of its own in either language to defer to). */}
      <div className={styles.overlay}>
        <ul className={styles.row}>
          {items.map(({ icon: Icon, ar, en }) => {
            const copy = isArabic ? ar : en;
            return (
              <li key={copy.title} className={styles.item}>
                <Icon className={styles.icon} aria-hidden="true" />
                <h3 className={styles.title}>{copy.title}</h3>
                <p className={styles.text}>{copy.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
