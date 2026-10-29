"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BoltIcon, ShoppingBagIcon, StarIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { landingMarketplaceContent, type LandingProduct } from "./landing-marketplace-content";
import styles from "./landing-marketplace.module.css";

const number = new Intl.NumberFormat("en-US");

/** Remaining time for an offer end timestamp; `null` until mounted (no SSR clock). */
function useRemaining(endsAt: number | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (typeof endsAt !== "number") return;
    const tick = () => setRemaining(Math.max(0, endsAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return remaining;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function LandingMarketplaceProductCard({ product }: { product: LandingProduct }) {
  const { locale } = useI18n();
  const t = landingMarketplaceContent[locale];
  const copy = product.copy[locale];
  const offer = product.offer;
  const remaining = useRemaining(offer?.endsAt);

  // An offer is live unless its end timestamp has passed. A flash offer without a
  // known end is never shown as active — a timer is never invented.
  const expired = offer?.kind === "flash" && typeof offer.endsAt === "number" && remaining === 0;
  const flashLive = offer?.kind === "flash" && typeof offer.endsAt === "number" && !expired;
  const regularLive = offer?.kind === "regular";
  const live = flashLive || regularLive;
  const total = remaining ?? 0;
  const parts = { h: Math.floor(total / 3_600_000), m: Math.floor((total % 3_600_000) / 60_000), s: Math.floor((total % 60_000) / 1000) };
  const price = locale === "ar" ? `${number.format(product.priceEgp)} ${t.currency}` : `${t.currency} ${number.format(product.priceEgp)}`;
  const was = offer && live ? (locale === "ar" ? `${number.format(offer.referencePriceEgp)} ${t.currency}` : `${t.currency} ${number.format(offer.referencePriceEgp)}`) : null;

  return (
    <article className={styles.card} data-product-type={product.type} data-offer={live ? offer?.kind : undefined}>
      <div className={styles.media}>
        <Image src={product.image} alt="" fill
          sizes="(max-width: 767px) 46vw, (max-width: 1023px) 30vw, 18vw" className={styles.image} />
        {flashLive ? (
          <div className={styles.flashStack}>
            <span className={`${styles.badge} ${styles.badgeFlash}`}><BoltIcon size={14} />{t.flash}</span>
            <div className={styles.timer} dir="ltr" role="timer" aria-label={`${t.flash}: ${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`}>
              {([["h", t.hours], ["m", t.minutes], ["s", t.seconds]] as const).map(([k, label]) => (
                <span key={k} className={styles.timerCell}>
                  <strong>{remaining === null ? "--" : pad(parts[k])}</strong>
                  <small>{label}</small>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {regularLive ? (
          <span className={`${styles.badge} ${styles.badgeSpecial}`}><StarIcon size={14} />{t.special}</span>
        ) : null}
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{copy.title}</h3>
        <p className={styles.desc}>{copy.description}</p>
        <div className={styles.priceRow}>
          <span className={styles.price}>{price}</span>
          {was ? <del className={styles.was} aria-label={`${t.was}: ${was}`}>{was}</del> : null}
        </div>
        <p className={styles.unitNote}>{t.units[product.unit]}</p>
        {/* No cart yet: the button opens /marketplace, which says the Marketplace is coming soon. */}
        <Link href="/marketplace" className={styles.addToCart}>
          <ShoppingBagIcon size={18} />
          {t.addToCart}
        </Link>
      </div>
    </article>
  );
}
