"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { categoryOrder, landingMarketplaceContent, previewProducts, type CategoryFilter } from "../landing-marketplace/landing-marketplace-content";
import { CategoryIcon } from "../landing-marketplace/landing-marketplace-icons";
import { brandContent } from "./landing-brand-content";
import { BrandIcon } from "./landing-brand-icons";
import styles from "./landing-brand.module.css";

const MAX_CARDS = 6;

/** Category chips + a horizontally scrolling row of at most six preview products (preview product data). */
export function LandingBrandMarket() {
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
      <div className={styles.chips} role="group" aria-label={cat.filterLabel}>
        {(["all", ...categoryOrder] as CategoryFilter[]).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? styles.chipOn : undefined} onClick={() => setFilter(key)}>
            <CategoryIcon type={key} /><span>{cat.categories[key]}</span>
          </button>
        ))}
      </div>
      <div className={styles.carousel}>
      <button type="button" className={styles.arrow} aria-label="السابق" onClick={() => step(-1)}><BrandIcon name="chevron" size={18} className={styles.chevPrev} /></button>
      <ul className={styles.cards} ref={row}>
        {products.map((p) => {
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
                <a href="/marketplace" aria-label={cat.addToCart} className={styles.cartBtn}><BrandIcon name="cart" size={18} /></a>
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
