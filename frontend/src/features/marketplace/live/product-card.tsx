"use client";

import Link from "next/link";
import { BadgeCheckFilledIcon, PackageIcon, TruckIcon } from "@/components/ui/icons";
import type { Locale } from "../marketplace-types";
import { CartAddButton } from "./cart-add-button";
import { estimateText } from "./delivery-model";
import { useMarketplaceImageSrc, useMarketplaceImageSrcSet } from "./image-urls";
import { fmtEgp, fmtNum, liveCopy } from "./live-copy";
import { deliveryCopy } from "./live-delivery-copy";
import { labelOf } from "./live-format";
import type { BuyerPlace, PublicCard } from "./public-contract";
import cart from "../marketplace.module.css";
import styles from "../marketplace-v2.module.css";

/** `?gov=&area=` of the buyer's place, carried to the product page so its delivery block opens on the same place. */
export function placeQuery(place: BuyerPlace | null | undefined): string {
  if (!place) return "";
  const sp = new URLSearchParams({ gov: place.gov });
  if (place.area) sp.set("area", place.area);
  return `?${sp.toString()}`;
}

/** The blue «Official Store» mark of a business-verified showroom (the existing business-verification state). */
export function OfficialBadge({ locale, href }: { locale: Locale; href?: string }) {
  const label = deliveryCopy[locale].officialStore;
  const inner = (
    <>
      <BadgeCheckFilledIcon size={14} className={styles.officialIcon} aria-hidden="true" />
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={styles.official}>
      {inner}
    </Link>
  ) : (
    <span className={styles.official}>{inner}</span>
  );
}

/**
 * Amazon-sized product card (browse-only): image, showroom (with the official-store mark), name, price, free-shipping
 * mark, the delivery estimate and «Only N left» from 3 units or fewer. No «in stock» label (a product with no units is
 * withdrawn from the catalog), no «sold by» sentence, no rating (ratings come later). Everything shown is database output.
 */
export function ProductCard({ item, locale, place }: { item: PublicCard; locale: Locale; place?: BuyerPlace | null }) {
  const t = liveCopy[locale];
  const d = deliveryCopy[locale];
  const title = labelOf(item, locale);
  const href = `/market/products/${item.slug}${placeQuery(place)}`;
  const imageSrc = useMarketplaceImageSrc();
  const imageSrcSet = useMarketplaceImageSrcSet();
  const eta = estimateText(item.delivery, locale);
  const notDelivered = item.delivery?.status === "not_available";
  return (
    <article className={styles.card} data-product-type={item.product_type_key}>
      <Link href={href} className={styles.media} aria-label={title}>
        {item.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- media Worker / no-store proxy; next/image would re-cache it
          <img src={imageSrc(item.image_id, "card")} srcSet={imageSrcSet(item.image_id)} sizes="(max-width: 767px) 50vw, 240px" alt="" loading="lazy" decoding="async" className={styles.image} />
        ) : (
          <span className={styles.placeholder} aria-hidden="true">
            <PackageIcon size={40} />
          </span>
        )}
      </Link>
      <div className={styles.body}>
        {item.seller_slug ? (
          <p className={styles.sellerLine}>
            <Link href={`/market/sellers/${item.seller_slug}`}>{item.seller_name}</Link>
            {item.seller_official ? <OfficialBadge locale={locale} /> : null}
          </p>
        ) : null}
        <h3 className={styles.title}>
          <Link href={href}>{title}</Link>
        </h3>
        <p className={styles.meta}>
          {labelOf({ name_ar: item.product_type_name_ar, name_en: item.product_type_name_en }, locale)}
          {item.variant_count > 1 ? ` · ${t.variants(fmtNum(item.variant_count, locale))}` : ""}
        </p>
        {item.colors?.length ? (
          <ul className={cart.dots} aria-hidden="true">
            {item.colors.slice(0, 8).map((hex) => (
              <li key={hex} className={cart.dot} style={{ background: hex }} />
            ))}
          </ul>
        ) : null}
        {item.from_price_egp !== null ? (
          <p className={styles.price}>
            {item.variant_count > 1 ? <span className={styles.from}>{t.from}</span> : null}
            <strong>{fmtEgp(Number(item.from_price_egp), locale)}</strong>
          </p>
        ) : null}
        {item.free_shipping ? (
          <span className={styles.freeBadge}>
            <TruckIcon size={14} aria-hidden="true" />
            {d.freeShipping}
          </span>
        ) : null}
        {eta ? (
          <p className={styles.estimate}>
            <TruckIcon size={14} aria-hidden="true" />
            {eta}
          </p>
        ) : null}
        {notDelivered ? <p className={styles.pickup}>{d.notDelivered}</p> : null}
        {item.delivery?.pickup_available ? <p className={styles.pickup}>{d.pickup}</p> : null}
        {item.stock_left ? <p className={styles.lowStock}>{d.onlyLeft(fmtNum(item.stock_left, locale))}</p> : null}
        <div className={styles.cardAction}>
          <CartAddButton slug={item.slug} sku={item.cart_sku} inStock={item.in_stock} sellerSlug={item.seller_slug} className={cart.cardCart} doneClassName={cart.cardCartDone} />
        </div>
      </div>
    </article>
  );
}
