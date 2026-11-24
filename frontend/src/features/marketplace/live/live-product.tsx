"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PackageIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { DeliveryBlock } from "./delivery-block";
import { deliveryCopy } from "./live-delivery-copy";
import { OfficialBadge } from "./product-card";
import { useIsOwnShowroom } from "./viewer-context";
import { liveCartCopy } from "./live-cart-copy";
import { useLiveCart } from "./live-cart-store";
import { useMarketplaceImageSrc } from "./image-urls";
import type { BuyerPlace, DeliveryTerms, PublicProduct } from "./public-contract";
import { fmtEgp, fmtNum, liveCopy } from "./live-copy";
import { attributeText as valueText, labelOf as label } from "./live-format";
import styles from "../marketplace.module.css";
import v2 from "../marketplace-v2.module.css";

/** Live product page: real gallery (approved images only), variant choice, honest non-purchasable state. */
export function LiveProduct({ product, terms = null, place = null }: { product: PublicProduct; terms?: DeliveryTerms | null; place?: BuyerPlace | null }) {
  const imageSrc = useMarketplaceImageSrc();
  const { locale, t: tr } = useI18n();
  const t = liveCopy[locale];
  const d = deliveryCopy[locale];
  const Sep = locale === "ar" ? ChevronLeftIcon : ChevronRightIcon;
  const c = liveCartCopy[locale];
  const cart = useLiveCart();
  // a showroom's own people cannot buy from it: no add-to-cart on its products (the database refuses it too)
  const ownShowroom = useIsOwnShowroom(product.seller_slug);
  const [added, setAdded] = useState<"added" | "cart_full" | null>(null);
  const [sku, setSku] = useState(product.variants[0]?.sku ?? "");
  const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];

  // product-level images first, then the chosen variant's own images
  const images = useMemo(
    () => product.images.filter((i) => !i.variant_sku || i.variant_sku === variant?.sku),
    [product.images, variant?.sku],
  );
  const [index, setIndex] = useState(0);
  // a variant button names only what tells the variants apart (e.g. colour), not values they all share
  const distinguishing = useMemo(() => {
    const keys = new Set(product.variants.flatMap((v) => v.attributes.map((a) => a.key)));
    return new Set(
      [...keys].filter((k) => new Set(product.variants.map((v) => JSON.stringify(v.attributes.find((a) => a.key === k)?.value ?? null))).size > 1),
    );
  }, [product.variants]);
  const current = images[Math.min(index, images.length - 1)];
  const title = label(product, locale);
  const description = (locale === "ar" ? product.description_ar : product.description_en) || product.description_ar || product.description_en;
  const typeName = locale === "ar" ? product.product_type_name_ar : product.product_type_name_en;
  const categoryName = locale === "ar" ? product.category_name_ar : product.category_name_en;

  return (
    <div className={styles.detail}>
      <nav className={styles.crumbs} aria-label={t.back}>
        <Link href="/market">{t.back}</Link>
        <Sep size={14} className={v2.crumbIcon} aria-hidden="true" />
        <Link href={`/market?category=${product.category_key}`}>{categoryName}</Link>
        <Sep size={14} className={v2.crumbIcon} aria-hidden="true" />
        <Link href={`/market?category=${product.category_key}&type=${product.product_type_key}`}>{typeName}</Link>
      </nav>

      <div className={styles.detailGrid}>
        <div className={styles.gallery}>
          <div className={v2.galleryRow}>
            {images.length > 1 ? (
              <ul className={v2.thumbCol} aria-label={t.back}>
                {images.map((img, i) => (
                  <li key={img.image_id}>
                    <button type="button" className={i === index ? v2.thumbOn : undefined} aria-label={`${i + 1} / ${images.length}`} aria-pressed={i === index} onClick={() => setIndex(i)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- no-store proxy */}
                      <img src={imageSrc(img.image_id, "thumb")} alt="" loading="lazy" decoding="async" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={v2.mainFrame}>
              {current ? (
                // eslint-disable-next-line @next/next/no-img-element -- no-store proxy
                <img src={imageSrc(current.image_id, "full")} fetchPriority="high" decoding="async" alt={(locale === "ar" ? current.alt_text_ar : current.alt_text_en) || title} />
              ) : (
                <span className={v2.placeholder} aria-hidden="true">
                  <PackageIcon size={56} />
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.buy}>
          {product.seller_slug ? (
            <p className={v2.sellerBar}>
              <Link href={`/market/sellers/${product.seller_slug}`} className={v2.sellerLink}>{product.seller_name}</Link>
              {product.seller_official ? <OfficialBadge locale={locale} href={`/market/sellers/${product.seller_slug}`} /> : null}
            </p>
          ) : null}
          <h1 className={styles.detailTitle}>{title}</h1>
          {description ? <p className={styles.detailDesc}>{description}</p> : null}

          {product.variants.length > 1 ? (
            <fieldset className={styles.axis}>
              <legend>{t.choose}</legend>
              <ul className={styles.pills}>
                {product.variants.map((v) => (
                  <li key={v.sku}>
                    <button
                      type="button"
                      className={`${styles.pill} ${v.sku === variant?.sku ? styles.pillActive : ""}`}
                      aria-pressed={v.sku === variant?.sku}
                      onClick={() => {
                        setSku(v.sku);
                        setIndex(0);
                      }}
                    >
                      {v.attributes.filter((a) => distinguishing.has(a.key)).map((a) => valueText(a, locale)).join(" · ") || v.sku}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {variant ? (
            <div className={styles.priceBox}>
              <p className={styles.bigPrice}>
                <strong>{fmtEgp(Number(variant.price_egp), locale)}</strong>
              </p>
              <p className={styles.sku}>
                {t.unit}: {tr(`marketplaceSeller.unit.${variant.selling_unit}`)}
              </p>
              <p className={styles.sku}>
                {t.sku}: <bdi dir="ltr">{variant.sku}</bdi>
              </p>
              {variant.stock_left ? <p className={v2.lowStockPage}>{d.onlyLeft(fmtNum(variant.stock_left, locale))}</p> : null}
              {ownShowroom ? null : (
                <>
              <button
                type="button"
                className={styles.addToCart}
                disabled={!variant.purchasable}
                onClick={() => setAdded(cart.add(product.slug, variant.sku))}
              >
                {variant.purchasable ? (cart.has(product.slug, variant.sku) ? c.inCart : c.addToCart) : t.outOfStock}
              </button>
              {added === "cart_full" ? <p className={styles.sku} role="status">{c.cartFull}</p> : null}
              {added === "added" && cart.has(product.slug, variant.sku) ? (
                <p className={styles.sku} role="status">
                  {c.addedToCart} · <Link href="/market/cart">{c.viewCart}</Link>
                </p>
              ) : null}
                </>
              )}
            </div>
          ) : null}

          <DeliveryBlock locale={locale} terms={terms} place={place} unitPrice={variant ? Number(variant.price_egp) : null} />

          {product.attributes.length || variant?.attributes.length || product.brand ? (
            <section className={styles.specs}>
              <h2 className={styles.h2}>{t.specs}</h2>
              <dl>
                {product.brand ? (
                  <div className={styles.specRow}>
                    <dt>{t.brand}</dt>
                    <dd>{product.brand}</dd>
                  </div>
                ) : null}
                {[...product.attributes, ...(variant?.attributes ?? [])].map((a, i) => (
                  <div key={`${i}:${a.key}`} className={styles.specRow}>
                    <dt>{label(a, locale)}</dt>
                    <dd>{valueText(a, locale)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
