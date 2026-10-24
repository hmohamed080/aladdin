"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BoltIcon, ShoppingBagIcon, StarIcon, TrashIcon } from "@/components/ui/icons";
import { useMarketplaceCart } from "@/features/marketplace/marketplace-cart";
import { previewProducts as catalogue } from "@/features/marketplace/marketplace-preview-data";
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
  const [notice, setNotice] = useState<"added" | "out" | "preview" | null>(null);
  const cart = useMarketplaceCart();
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

  /** Landing sample products mirror the Marketplace sample catalogue ("wp-1" is "p-wp-1"); the cheapest in-stock variant is added. */
  const match = catalogue.find((p) => p.id === `p-${product.id}`);
  const inCart = match ? cart.hasProduct(match.id) : false;
  const addToCart = () => {
    if (match && inCart) {
      cart.removeProduct(match.id);
      return setNotice(null);
    }
    const variant = match?.variants.filter((v) => v.stock > 0).sort((a, b) => a.priceEgp - b.priceEgp)[0];
    if (!match) return setNotice("preview");
    if (!variant) return setNotice("out");
    setNotice(cart.add(match.id, variant.id) === "added" ? "added" : "out");
  };

  return (
    <article className={styles.card} data-product-type={product.type} data-offer={live ? offer?.kind : undefined}>
      <div className={styles.media}>
        <Image src={product.image} alt="" fill unoptimized
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
        <button type="button" className={`${styles.addToCart} ${inCart ? styles.addToCartOn : ""}`} aria-pressed={inCart} onClick={addToCart}>
          {inCart ? <TrashIcon size={18} /> : <ShoppingBagIcon size={18} />}
          {inCart ? t.removeFromCart : t.addToCart}
        </button>
        <p className={styles.notice} role="status" hidden={!notice}>
          {notice === "added" ? (<>{t.added} · <a href="/marketplace/cart">{t.viewCart}</a></>) : notice === "out" ? t.outOfStock : notice === "preview" ? t.previewOnly : ""}
        </p>
      </div>
    </article>
  );
}
