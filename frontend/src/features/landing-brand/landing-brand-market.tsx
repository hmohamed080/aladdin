"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { categoryOrder, landingMarketplaceContent, previewProducts, type CategoryFilter } from "../landing-marketplace/landing-marketplace-content";
import { CategoryIcon } from "../landing-marketplace/landing-marketplace-icons";
import { CartAddButton } from "../marketplace/live/cart-add-button";
import { useMarketplaceImageSrc } from "../marketplace/live/image-urls";
import { fmtEgp, liveCopy } from "../marketplace/live/live-copy";
import type { PublicCard } from "../marketplace/live/public-contract";
import { brandContent } from "./landing-brand-content";
import { BrandIcon } from "./landing-brand-icons";
import styles from "./landing-brand.module.css";

const MAX_CARDS = 6;

/**
 * A real Marketplace product (shown while the Marketplace is open): name, price and stock come from the public
 * catalogue, "Add to cart" fills the browser cart the header counts, and the card opens the product page.
 */
function LiveCard({ item }: { item: PublicCard }) {
  const imageSrc = useMarketplaceImageSrc();
  const t = liveCopy.ar;
  const title = item.name_ar || item.name_en;
  const href = `/market/products/${item.slug}`;
  return (
    <li className={`${styles.card} ${styles.cardLive}`}>
      <a href={href} className={styles.cardImg} aria-label={title}>
        {item.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- media Worker / no-store proxy
          <img src={imageSrc(item.image_id, "card")} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </a>
      <div className={styles.cardBody}>
        <div>
          <strong><a href={href}>{title}</a></strong>
          <span>{item.from_price_egp === null ? "—" : `${item.variant_count > 1 ? `${t.from} ` : ""}${fmtEgp(Number(item.from_price_egp), "ar")}`}</span>
          <span className={styles.cardSeller}>{t.soldBy(item.seller_name)}</span>
        </div>
        <CartAddButton slug={item.slug} sku={item.cart_sku} inStock={item.in_stock} sellerSlug={item.seller_slug} className={styles.cartAdd} doneClassName={styles.cartAddDone} />
      </div>
    </li>
  );
}

/** Category chips + a horizontally scrolling row of at most six preview products; real products replace both while the Marketplace is open. */
export function LandingBrandMarket({ live = [] }: { live?: PublicCard[] } = {}) {
  const showLive = live.length > 0;
  const t = brandContent.market;
  const cat = landingMarketplaceContent.ar;
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const products = useMemo(
    () => (filter === "all" ? previewProducts.filter((p) => p.featured) : previewProducts.filter((p) => p.type === filter)).slice(0, MAX_CARDS),
    [filter],
  );
  const row = useRef<HTMLUListElement>(null);
  // Scroll by one card; in RTL scrollLeft runs negative, so "next" moves the other way.
  const step = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 240;
    el.scrollBy({ left: dir * -1 * (card + 20), behavior: "smooth" });
  };
  const nf = new Intl.NumberFormat("en-US");

  return (
    <>
      {showLive ? null : (
      <div className={styles.chips} role="group" aria-label={cat.filterLabel}>
        {(["all", ...categoryOrder] as CategoryFilter[]).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? styles.chipOn : undefined} onClick={() => setFilter(key)}>
            <CategoryIcon type={key} /><span>{cat.categories[key]}</span>
          </button>
        ))}
      </div>
      )}
      <div className={styles.carousel}>
      <button type="button" className={styles.arrow} aria-label="السابق" onClick={() => step(-1)}><BrandIcon name="chevron" size={18} className={styles.chevPrev} /></button>
      <ul className={styles.cards} ref={row}>
        {showLive ? live.map((item) => <LiveCard key={item.slug} item={item} />) : products.map((p) => {
          const copy = p.copy.ar;
          const on = !!favs[p.id];
          return (
            <li key={p.id} className={styles.card}>
              <div className={styles.cardImg}>
                <Image src={p.image} alt={copy.title} fill sizes="(max-width: 900px) 33vw, 260px" />
                <button type="button" className={styles.heart} aria-pressed={on} aria-label={copy.title} onClick={() => setFavs({ ...favs, [p.id]: !on })}>
                  <BrandIcon name="heart" size={26} fill={on ? "currentColor" : "none"} />
                </button>
              </div>
              <div className={styles.cardBody}>
                <div><strong>{copy.title}</strong><span>{nf.format(p.priceEgp)} <small>{t.currency}</small></span></div>
                <a href="/market" aria-label={cat.addToCart} className={styles.cartBtn}><BrandIcon name="cart" size={18} /></a>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.arrow} aria-label="التالي" onClick={() => step(1)}><BrandIcon name="chevron" size={18} className={styles.chevNext} /></button>
      </div>
    </>
  );
}
