"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { BoltIcon, HeartFilledIcon, HeartIcon, ShoppingBagIcon, StarIcon, TrashIcon } from "@/components/ui/icons";
import type { ListedProduct } from "./marketplace-filters";
import { formatPrice, marketplaceCopy } from "./marketplace-copy";
import { useMarketplaceCart } from "./marketplace-cart";
import { bestSellerIds } from "./marketplace-preview-data";
import { colorCatalog } from "./marketplace-schema";
import type { Locale } from "./marketplace-types";
import styles from "./marketplace.module.css";

/** Distinct color swatches of the matching variants (data-driven from the shared Color Catalog). */
function swatches(item: ListedProduct) {
  const keys = new Set<string>();
  for (const v of item.variants) {
    const c = v.values.color;
    if (typeof c === "string") keys.add(c);
  }
  return [...keys].map((k) => colorCatalog.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => Boolean(c));
}

export function MarketplaceProductCard({ item, locale }: { item: ListedProduct; locale: Locale }) {
  const t = marketplaceCopy[locale];
  const { product } = item;
  const dots = swatches(item);
  const offer = product.offer;
  const [fav, setFav] = useState(false);
  const [notice, setNotice] = useState(false);
  const cart = useMarketplaceCart();
  const inCart = cart.hasProduct(product.id);
  const buyable = [...item.variants].filter((v) => v.stock > 0).sort((a, b) => a.priceEgp - b.priceEgp)[0];
  return (
    <article className={styles.card} data-product-type={product.type}>
      <Link href={`/marketplace/products/${product.slug}`} className={styles.cardMedia} aria-label={product.name[locale]}>
        <Image src={product.images[0]!} alt="" fill sizes="(max-width: 767px) 46vw, (max-width: 1279px) 30vw, 22vw" className={styles.cardImage} />
        {offer?.kind === "flash" ? (
          <span className={`${styles.badge} ${styles.badgeFlash}`}><BoltIcon size={14} />{t.flash}</span>
        ) : null}
        {bestSellerIds.has(product.id) ? (
          <span className={`${styles.badge} ${styles.badgeBest}`}><StarIcon size={14} />{t.bestSeller}</span>
        ) : null}
        {offer?.kind === "regular" ? (
          <span className={`${styles.badge} ${styles.badgeSpecial}`}><StarIcon size={14} />{t.special}</span>
        ) : null}
      </Link>
      <button type="button" className={styles.fav} aria-pressed={fav} aria-label={t.favorite} onClick={() => setFav((v) => !v)}>
        {fav ? <HeartFilledIcon size={18} /> : <HeartIcon size={18} />}
      </button>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>
          <Link href={`/marketplace/products/${product.slug}`}>{product.name[locale]}</Link>
        </h3>
        <p className={styles.cardMeta}>
          {t.types[product.type]} · {t.variants(item.variants.length)}
        </p>
        {dots.length > 0 ? (
          <ul className={styles.dots} aria-label={dots.map((d) => d.name[locale]).join(", ")}>
            {dots.slice(0, 6).map((d) => (
              <li key={d.key} className={styles.dot} style={{ background: d.hex }} title={d.name[locale]} />
            ))}
          </ul>
        ) : null}
        <p className={styles.cardPrice}>
          <span className={styles.from}>{item.priceVaries ? `${t.from} ` : ""}</span>
          <strong>{formatPrice(item.fromPriceEgp, locale)}</strong>
          {offer ? <del aria-label={`${t.was}: ${formatPrice(offer.referencePriceEgp, locale)}`}>{formatPrice(offer.referencePriceEgp, locale)}</del> : null}
        </p>
        <p className={styles.cardUnit}>{t.units[product.unit]}</p>
        <p className={`${styles.stock} ${item.purchasable ? styles.stockIn : styles.stockOut}`}>
          {item.purchasable ? t.inStock : t.outOfStock}
        </p>
        <button type="button" className={`${styles.cardAdd} ${inCart ? styles.cardAddOn : ""}`} aria-pressed={inCart} disabled={!buyable && !inCart}
          onClick={() => {
            if (inCart) { cart.removeProduct(product.id); setNotice(false); return; }
            if (buyable && cart.add(product.id, buyable.id) === "added") setNotice(true);
          }}>
          {inCart ? <TrashIcon size={16} aria-hidden="true" /> : <ShoppingBagIcon size={16} aria-hidden="true" />}
          {inCart ? t.removeFromCart : t.addToCart}
        </button>
        <p className={styles.cardNotice} role="status">{notice ? t.addedToCart : ""}</p>
      </div>
    </article>
  );
}
