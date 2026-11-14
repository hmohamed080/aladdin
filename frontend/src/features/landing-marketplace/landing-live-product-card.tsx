"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { CartAddButton } from "@/features/marketplace/live/cart-add-button";
import { useMarketplaceImageSrc } from "@/features/marketplace/live/image-urls";
import { fmtEgp, liveCopy } from "@/features/marketplace/live/live-copy";
import type { PublicCard } from "@/features/marketplace/live/public-contract";
import styles from "./landing-marketplace.module.css";

/**
 * A real Marketplace product on the home page (shown while the Marketplace is open): the same card
 * look as the preview cards, with a working "Add to cart" that fills the browser cart the header
 * counts. Name, price and stock come from the public catalogue; the cart re-prices on its own page.
 */
export function LandingLiveProductCard({ item }: { item: PublicCard }) {
  const { locale } = useI18n();
  const t = liveCopy[locale];
  const imageSrc = useMarketplaceImageSrc();
  const title = locale === "ar" ? item.name_ar || item.name_en : item.name_en || item.name_ar;
  const href = `/marketplace/products/${item.slug}`;
  return (
    <article className={styles.card} data-product-type={item.product_type_key}>
      <Link href={href} className={styles.media} aria-label={title}>
        {item.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- media Worker / no-store proxy
          <img src={imageSrc(item.image_id, "card")} alt="" loading="lazy" className={styles.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </Link>
      <div className={styles.body}>
        <h3 className={styles.title}><Link href={href}>{title}</Link></h3>
        <p className={styles.desc}>{t.soldBy(item.seller_name)}</p>
        <div className={styles.priceRow}>
          <span className={styles.price}>
            {item.from_price_egp === null ? "—" : `${item.variant_count > 1 ? `${t.from} ` : ""}${fmtEgp(Number(item.from_price_egp), locale)}`}
          </span>
        </div>
        <CartAddButton slug={item.slug} sku={item.cart_sku} inStock={item.in_stock} className={styles.addToCart} doneClassName={styles.addToCartDone} />
      </div>
    </article>
  );
}
