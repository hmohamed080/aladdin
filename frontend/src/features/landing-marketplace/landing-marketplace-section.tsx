"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  categoryOrder,
  landingMarketplaceContent,
  previewProducts,
  type CategoryFilter,
  type LandingProduct,
} from "./landing-marketplace-content";
import { ArrowIcon, CategoryIcon } from "./landing-marketplace-icons";
import { LandingMarketplaceProductCard } from "./landing-marketplace-product-card";
import { LandingLiveProductCard } from "./landing-live-product-card";
import type { PublicCard } from "@/features/marketplace/live/public-contract";
import styles from "./landing-marketplace.module.css";

/** Preview-only: a sample flash window so the countdown UI can be reviewed. */
const DEMO_FLASH_MS = ((12 * 60 + 45) * 60 + 30) * 1000;

/**
 * Landing section announcing the upcoming Aladdin Marketplace.
 *
 * Source of truth is `previewProducts` (clearly labelled sample data). It does
 * has no cart and does not talk to payments or inventory; "Add to cart" and the
 * CTA both open /marketplace, which says the Marketplace is coming soon.
 */
export function LandingMarketplaceSection({ live }: { live?: PublicCard[] } = {}) {
  const { locale, dir } = useI18n();
  const t = landingMarketplaceContent[locale];
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [demoEnd, setDemoEnd] = useState<number | null>(null);
  useEffect(() => setDemoEnd(Date.now() + DEMO_FLASH_MS), []);

  const products = useMemo<LandingProduct[]>(() => {
    const withEnds = previewProducts.map((p) =>
      p.offer?.kind === "flash" ? { ...p, offer: { ...p.offer, endsAt: demoEnd } } : p,
    );
    return filter === "all" ? withEnds.filter((p) => p.featured) : withEnds.filter((p) => p.type === filter);
  }, [filter, demoEnd]);

  const filters: CategoryFilter[] = ["all", ...categoryOrder];
  // While the Marketplace is open the home page shows real products with a working cart instead of the samples.
  const showLive = Boolean(live && live.length > 0);

  return (
    <section id="marketplace" className={styles.section} dir={dir} aria-labelledby="marketplace-heading" data-landing-preview-part="Marketplace">
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h2 id="marketplace-heading" className={styles.heading}>
          <span>{t.headingLead}</span> <span className={styles.accent}>{t.headingAccent}</span>
        </h2>
        <p className={styles.description}>{t.description}</p>
        {showLive ? null : <p className={styles.previewChip}>{t.preview}</p>}
      </header>

      {showLive ? (
        <ul className={styles.grid}>
          {live!.map((item) => (
            <li key={item.slug} className={styles.gridItem}>
              <LandingLiveProductCard item={item} />
            </li>
          ))}
        </ul>
      ) : (<>
      <div className={styles.tabs} role="group" aria-label={t.filterLabel}>
        {filters.map((key) => (
          <button key={key} type="button" className={`${styles.tab} ${filter === key ? styles.tabActive : ""}`}
            aria-pressed={filter === key} onClick={() => setFilter(key)}>
            <CategoryIcon type={key} />
            <span>{t.categories[key]}</span>
          </button>
        ))}
      </div>

      <p className={styles.srOnly} role="status">{t.resultsCount(products.length)}</p>
      {products.length === 0 ? (
        <p className={styles.empty}>{t.empty}</p>
      ) : (
        <ul className={styles.grid}>
          {products.map((product) => (
            <li key={product.id} className={styles.gridItem}>
              <LandingMarketplaceProductCard product={product} />
            </li>
          ))}
        </ul>
      )}

      </>)}

      <div className={styles.moreWrap}>
        <Link href="/marketplace" className={styles.more}>
          <span>{t.moreProducts}</span>
          <span className={styles.moreIcon} aria-hidden="true"><ArrowIcon /></span>
        </Link>
      </div>
      {showLive ? null : <p className={styles.previewNote}>{t.previewNote}</p>}
    </section>
  );
}
