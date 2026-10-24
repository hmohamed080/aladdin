"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PackageIcon } from "@/components/ui/icons";
import type { PublicCard } from "@/features/marketplace/live/public-contract";
import { fmtEgp, fmtNum, liveCopy } from "@/features/marketplace/live/live-copy";
import { useI18n } from "@/lib/i18n/context";
import { categoryOrder, landingMarketplaceContent, type CategoryFilter } from "./landing-marketplace-content";
import { ArrowIcon, CategoryIcon } from "./landing-marketplace-icons";
import styles from "./landing-marketplace.module.css";

/** Cards shown at once, as in the approved section (one row on desktop). */
const VISIBLE = 6;
const GLYPHS = new Set<string>(categoryOrder);

/**
 * Landing "Aladdin Marketplace" section on REAL data: the newest published
 * products of approved sellers (`marketplace_public_catalog_page`), their real
 * names, cover images, from-prices (tax exclusive) and stock. Tabs exist only
 * for product types that actually have published products. No sample
 * products, prices, offers, countdowns or cart — each card opens the product
 * page, and the CTA opens the full Marketplace.
 */
export function LandingMarketplaceLive({ items }: { items: PublicCard[] }) {
  const { locale, dir } = useI18n();
  const t = landingMarketplaceContent[locale];
  const live = liveCopy[locale];
  const [filter, setFilter] = useState<string>("all");

  const types = useMemo(() => {
    const seen = new Map<string, { key: string; name: string }>();
    for (const i of items) {
      if (!seen.has(i.product_type_key)) {
        seen.set(i.product_type_key, { key: i.product_type_key, name: (locale === "ar" ? i.product_type_name_ar : i.product_type_name_en) || i.product_type_name_ar });
      }
    }
    return [...seen.values()];
  }, [items, locale]);

  const shown = (filter === "all" ? items : items.filter((i) => i.product_type_key === filter)).slice(0, VISIBLE);
  const moreHref = filter === "all" ? "/marketplace" : `/marketplace?type=${filter}&category=${items.find((i) => i.product_type_key === filter)?.category_key ?? ""}`;

  return (
    <section id="marketplace" className={styles.section} dir={dir} aria-labelledby="marketplace-heading" data-landing-preview-part="Marketplace">
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h2 id="marketplace-heading" className={styles.heading}>
          <span>{t.headingLead}</span> <span className={styles.accent}>{t.headingAccent}</span>
        </h2>
        <p className={styles.description}>{t.description}</p>
      </header>

      {types.length > 1 ? (
        <div className={styles.tabs} role="group" aria-label={t.filterLabel}>
          {[{ key: "all", name: t.categories.all }, ...types].map((ty) => (
            <button key={ty.key} type="button" className={`${styles.tab} ${filter === ty.key ? styles.tabActive : ""}`} aria-pressed={filter === ty.key} onClick={() => setFilter(ty.key)}>
              {ty.key === "all" || GLYPHS.has(ty.key) ? <CategoryIcon type={ty.key as CategoryFilter} /> : <PackageIcon size={22} aria-hidden="true" />}
              <span>{ty.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <p className={styles.srOnly} role="status">
        {live.results(fmtNum(shown.length, locale))}
      </p>
      {shown.length === 0 ? (
        <p className={styles.empty}>{live.emptyTitle}</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((item) => {
            const name = (locale === "ar" ? item.name_ar : item.name_en) || item.name_ar || item.name_en;
            const typeName = (locale === "ar" ? item.product_type_name_ar : item.product_type_name_en) || item.product_type_name_ar;
            const href = `/marketplace/products/${item.slug}`;
            return (
              <li key={item.slug} className={styles.gridItem}>
                <article className={styles.card} data-product-type={item.product_type_key}>
                  <Link href={href} className={styles.media} aria-label={name}>
                    {item.image_id ? (
                      // eslint-disable-next-line @next/next/no-img-element -- no-store media proxy; next/image would re-cache it
                      <img src={`/marketplace/media/${item.image_id}`} alt="" loading="lazy" className={styles.image} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
                    ) : (
                      <span className={styles.empty}>{live.noImage}</span>
                    )}
                  </Link>
                  <div className={styles.body}>
                    <h3 className={styles.title}>
                      <Link href={href}>{name}</Link>
                    </h3>
                    <p className={styles.desc}>
                      {typeName}
                      {item.variant_count > 1 ? ` · ${live.variants(fmtNum(item.variant_count, locale))}` : ""}
                    </p>
                    {item.from_price_egp !== null ? (
                      <div className={styles.priceRow}>
                        <span className={styles.price}>
                          {item.variant_count > 1 ? `${live.from} ` : ""}
                          {fmtEgp(Number(item.from_price_egp), locale)}
                        </span>
                      </div>
                    ) : null}
                    <p className={styles.unitNote}>
                      {live.taxNote} · {item.in_stock ? live.inStock : live.outOfStock}
                    </p>
                    <p className={styles.unitNote}>{live.soldBy(item.seller_name)}</p>
                    <Link href={href} className={styles.addToCart}>
                      {live.viewProduct}
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.moreWrap}>
        <Link href={moreHref} className={styles.more}>
          <span>{t.moreProducts}</span>
          <span className={styles.moreIcon} aria-hidden="true">
            <ArrowIcon />
          </span>
        </Link>
      </div>
    </section>
  );
}
