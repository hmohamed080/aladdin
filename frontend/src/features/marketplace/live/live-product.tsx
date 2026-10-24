"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { liveCartCopy } from "./live-cart-copy";
import { useLiveCart } from "./live-cart-store";
import type { PublicProduct } from "./public-contract";
import { fmtEgp, liveCopy } from "./live-copy";
import { attributeText as valueText, labelOf as label } from "./live-format";
import styles from "../marketplace.module.css";

/** Live product page: real gallery (approved images only), variant choice, honest non-purchasable state. */
export function LiveProduct({ product }: { product: PublicProduct }) {
  const { locale, t: tr } = useI18n();
  const t = liveCopy[locale];
  const c = liveCartCopy[locale];
  const cart = useLiveCart();
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
        <Link href="/marketplace">{t.back}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/marketplace?category=${product.category_key}`}>{categoryName}</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/marketplace?category=${product.category_key}&type=${product.product_type_key}`}>{typeName}</Link>
      </nav>

      <div className={styles.detailGrid}>
        <div className={styles.gallery}>
          <div className={styles.galleryMain}>
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element -- no-store proxy
              <img
                src={`/marketplace/media/${current.image_id}`}
                alt={(locale === "ar" ? current.alt_text_ar : current.alt_text_en) || title}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <span className="grid h-full place-items-center text-[var(--stone)]">{t.noImage}</span>
            )}
          </div>
          {images.length > 1 ? (
            <ul className={styles.thumbs}>
              {images.map((img, i) => (
                <li key={img.image_id}>
                  <button
                    type="button"
                    className={i === index ? styles.thumbActive : undefined}
                    aria-label={`${i + 1} / ${images.length}`}
                    aria-pressed={i === index}
                    onClick={() => setIndex(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- no-store proxy */}
                    <img src={`/marketplace/media/${img.image_id}`} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={styles.buy}>
          <p className={styles.kicker}>
            {typeName} · {t.soldBy(product.seller_name)}
          </p>
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
                {t.taxNote} · {t.unit}: {tr(`marketplaceSeller.unit.${variant.selling_unit}`)}
              </p>
              <p className={styles.sku}>
                {t.sku}: <bdi dir="ltr">{variant.sku}</bdi>
              </p>
              <p className={`${styles.stock} ${variant.purchasable ? styles.stockIn : styles.stockOut}`}>
                {variant.purchasable ? t.inStock : t.outOfStock}
              </p>
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
                  {c.addedToCart} · <Link href="/marketplace/cart">{c.viewCart}</Link>
                </p>
              ) : null}
              <p className={styles.notice}>{t.honestNote}</p>
            </div>
          ) : null}

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
                {[...product.attributes, ...(variant?.attributes ?? [])].map((a) => (
                  <div key={a.key} className={styles.specRow}>
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
