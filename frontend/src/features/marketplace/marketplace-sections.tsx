"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheckIcon, BoltIcon, HelpIcon, PackageIcon, ShieldIcon, TruckIcon } from "@/components/ui/icons";
import { CategoryIcon } from "@/features/landing-marketplace/landing-marketplace-icons";
import { marketplaceCopy } from "./marketplace-copy";
import { previewProducts } from "./marketplace-preview-data";
import { TYPE_KEYS, type Locale, type TypeKey } from "./marketplace-types";
import styles from "./marketplace-store.module.css";

/** Types that have a dedicated glyph in the landing set; the rest fall back to a generic package icon. */
const GLYPH_TYPES = new Set<string>(["wallpaper", "wood_alternative", "marble_alternative", "sheeboard", "cornice", "corner_trim"]);

/** Cover photo per type for the category row: a dedicated type photo, else the first sample product of that type. */
const TYPE_COVERS: Partial<Record<TypeKey, string>> = {
  panels: "/preview/landing/marketplace/type-panels.webp",
  skirting: "/preview/landing/marketplace/type-skirting.webp",
  interior_doors: "/preview/landing/marketplace/type-interior-doors.webp",
  armored_doors: "/preview/landing/marketplace/type-armored-doors.webp",
  vinyl_flooring: "/preview/landing/marketplace/type-vinyl-flooring.webp",
  spc_flooring: "/preview/landing/marketplace/type-spc-flooring.webp",
  curtains: "/preview/landing/marketplace/type-curtains.webp",
  posters: "/preview/landing/marketplace/type-posters.webp",
  paints: "/preview/landing/marketplace/type-paints.webp",
};
export const typeImage = (type: TypeKey) => TYPE_COVERS[type] ?? previewProducts.find((p) => p.type === type)?.images[0];

export function MarketplaceHero({ q, locale, dir, onSearch }: { q: string; locale: Locale; dir: "rtl" | "ltr"; onSearch: (q: string) => void }) {
  const t = marketplaceCopy[locale];
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(draft);
  };
  const art = (["wood_alternative", "marble_alternative", "cornice"] as TypeKey[]).map(typeImage).filter((x): x is string => Boolean(x));
  const icons = [TruckIcon, ShieldIcon, HelpIcon, BadgeCheckIcon];
  return (
    <section className={styles.hero} dir={dir} aria-labelledby="mp-hero-title">
      <div className={styles.heroText}>
        <h1 id="mp-hero-title" className={styles.heroTitle}>{t.title}</h1>
        <p className={styles.heroTagline}>{t.heroTagline}</p>
        <p className={styles.heroLine}>{t.heroLine}</p>
        <form className={styles.heroSearch} role="search" onSubmit={submit}>
          <label className={styles.srOnly} htmlFor="mp-search">{t.searchLabel}</label>
          <input id="mp-search" type="search" value={draft} placeholder={t.searchPlaceholder} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit">{t.searchButton}</button>
        </form>
      </div>
      <ul className={styles.trust}>
        {t.trust.map((label, i) => {
          const Icon = icons[i]!;
          return <li key={label}><Icon size={18} aria-hidden="true" />{label}</li>;
        })}
      </ul>
      <div className={styles.heroArt} aria-hidden="true">
        {art.map((src) => <span key={src}><Image src={src} alt="" fill unoptimized sizes="160px" /></span>)}
      </div>
    </section>
  );
}

export function MarketplaceCategoryStrip({ active, locale, onPick }: { active: TypeKey | null; locale: Locale; onPick: (t: TypeKey | null) => void }) {
  const t = marketplaceCopy[locale];
  return (
    <div className={styles.strip} role="group" aria-label={t.typesLabel}>
      <button type="button" className={`${styles.stripItem} ${active === null ? styles.stripItemActive : ""}`} aria-pressed={active === null} onClick={() => onPick(null)}>
        <span className={`${styles.stripMedia} ${styles.stripMosaic}`}>
          {(["wallpaper", "marble_alternative", "panels", "curtains"] as TypeKey[]).map((k) => {
            const src = typeImage(k);
            return src ? <span key={k} className={styles.mosaicCell}><Image src={src} alt="" fill unoptimized sizes="60px" /></span> : null;
          })}
        </span>
        <span>{t.allTypes}</span>
      </button>
      {TYPE_KEYS.map((key) => {
        const src = typeImage(key);
        return (
          <button key={key} type="button" className={`${styles.stripItem} ${active === key ? styles.stripItemActive : ""}`} aria-pressed={active === key} onClick={() => onPick(key)}>
            <span className={styles.stripMedia}>
              {src ? (
                <Image src={src} alt="" fill unoptimized sizes="120px" />
              ) : GLYPH_TYPES.has(key) ? (
                <CategoryIcon type={key as "wallpaper"} />
              ) : (
                <PackageIcon size={26} aria-hidden="true" />
              )}
            </span>
            <span>{t.types[key]}</span>
          </button>
        );
      })}
    </div>
  );
}

const DEMO_FLASH_MS = 10 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Countdown for the SAMPLE flash banner (demo end set on mount; never a real campaign clock). */
export function MarketplaceFlashBanner({ locale, onShowOffers }: { locale: Locale; onShowOffers: () => void }) {
  const t = marketplaceCopy[locale];
  const [end, setEnd] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const start = Date.now();
    setEnd(start + DEMO_FLASH_MS);
    setNow(start);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = end === null ? null : Math.max(0, end - now);
  const parts = left === null ? null : { h: Math.floor(left / 3_600_000), m: Math.floor((left % 3_600_000) / 60_000), s: Math.floor((left % 60_000) / 1000) };
  return (
    <section className={styles.flash} aria-label={t.flashBannerTitle}>
      <div className={styles.flashHead}>
        <BoltIcon size={36} aria-hidden="true" />
        <div>
          <h2 className={styles.flashTitle}>{t.flashBannerTitle}</h2>
          <p className={styles.flashText}>{t.flashBannerText}</p>
        </div>
      </div>
      <div className={styles.flashTimer} dir="ltr" role="timer" aria-label={t.flashBannerTitle}>
        {([["h", t.hours], ["m", t.minutes], ["s", t.seconds]] as const).map(([k, label]) => (
          <span key={k} className={styles.flashCell}><strong>{parts ? pad(parts[k]) : "--"}</strong><small>{label}</small></span>
        ))}
      </div>
      <button type="button" className={styles.flashCta} onClick={onShowOffers}>{t.flashBannerCta}</button>
    </section>
  );
}

export function MarketplaceCta({ locale }: { locale: Locale }) {
  const t = marketplaceCopy[locale];
  return (
    <section className={styles.cta} aria-labelledby="mp-cta-title">
      <h2 id="mp-cta-title" className={styles.ctaTitle}>{t.ctaTitle}</h2>
      <p className={styles.ctaText}>{t.ctaText}</p>
      <div className={styles.ctaActions}>
        <Link className={styles.ctaSecondary} href="/auth/support">{t.ctaContact}</Link>
        <Link className={styles.ctaPrimary} href="/auth/sign-up">{t.ctaAccount}</Link>
      </div>
    </section>
  );
}
