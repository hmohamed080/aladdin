"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckIcon, HeartFilledIcon, HeartIcon, ShoppingBagIcon, StarOutlineIcon, TrashIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { useMarketplaceCart } from "./marketplace-cart";
import { formatLength, formatPrice, formatWeight, marketplaceCopy } from "./marketplace-copy";
import { MarketplaceGallery } from "./marketplace-gallery";
import { previewProducts } from "./marketplace-preview-data";
import { colorCatalog, fieldOptionName, typeSchemas } from "./marketplace-schema";
import type { FieldValue, Locale, PreviewProduct, PreviewVariant, SchemaField } from "./marketplace-types";
import styles from "./marketplace-detail.module.css";

/** V1 product form/picker supports up to 3 variant axes (a UI limit, not a database constraint). */
const MAX_AXES = 3;

function displayValue(field: SchemaField, value: FieldValue, locale: Locale, yes: string): string {
  if (field.valueType === "boolean") return value ? yes : "—";
  if (field.valueType === "measurement") return formatLength(Number(value), locale);
  if (field.valueType === "weight") return formatWeight(Number(value), locale);
  return fieldOptionName(field, String(value), locale);
}

const TABS = ["details", "specs", "install", "shipping", "reviews"] as const;
type Tab = (typeof TABS)[number];
/** Tabs whose content is not built yet are shown, disabled, with a Coming soon label. */
const SOON_TABS: Tab[] = ["install", "shipping", "reviews"];

function RelatedCard({ product, locale }: { product: PreviewProduct; locale: Locale }) {
  const t = marketplaceCopy[locale];
  const [fav, setFav] = useState(false);
  const cart = useMarketplaceCart();
  const [added, setAdded] = useState(false);
  const inCart = cart.hasProduct(product.id);
  const buyable = product.variants.filter((v) => v.stock > 0).sort((a, b) => a.priceEgp - b.priceEgp)[0];
  const from = buyable?.priceEgp ?? Math.min(...product.variants.map((v) => v.priceEgp));
  return (
    <article className={styles.related}>
      <Link href={`/marketplace/products/${product.slug}`} className={styles.relatedMedia} aria-label={product.name[locale]}>
        <Image src={product.images[0]!} alt="" fill sizes="(max-width: 767px) 46vw, 18vw" className={styles.stageImage} />
      </Link>
      <button type="button" className={styles.relatedFav} aria-pressed={fav} aria-label={t.favorite} onClick={() => setFav((v) => !v)}>
        {fav ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
      </button>
      <div className={styles.relatedBody}>
        <h3><Link href={`/marketplace/products/${product.slug}`}>{product.name[locale]}</Link></h3>
        <p className={styles.relatedPrice}>{formatPrice(from, locale)}</p>
        <button type="button" className={`${styles.relatedCart} ${inCart ? styles.relatedCartOn : ""}`} aria-pressed={inCart}
          aria-label={`${inCart ? t.removeFromCart : t.addToCart}: ${product.name[locale]}`} disabled={!buyable && !inCart}
          onClick={() => {
            if (inCart) { cart.removeProduct(product.id); setAdded(false); return; }
            if (buyable && cart.add(product.id, buyable.id) === "added") setAdded(true);
          }}>
          {inCart ? <TrashIcon size={16} aria-hidden="true" /> : <ShoppingBagIcon size={16} aria-hidden="true" />}
        </button>
        {added ? <p className={styles.srOnly} role="status">{t.addedToCart}</p> : null}
      </div>
    </article>
  );
}

export function MarketplaceProductDetail({ product }: { product: PreviewProduct }) {
  const { locale, dir } = useI18n();
  const t = marketplaceCopy[locale];
  const schema = typeSchemas[product.type];
  const cart = useMarketplaceCart();

  const axes = useMemo(
    () =>
      schema
        .filter((f) => f.scope === "variant" && f.variantAxis && product.variants.some((v) => v.values[f.key] !== undefined))
        .slice(0, MAX_AXES),
    [schema, product.variants],
  );

  const initial = product.variants.find((v) => v.stock > 0) ?? product.variants[0]!;
  const [selection, setSelection] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(axes.map((a) => [a.key, initial.values[a.key] as FieldValue])),
  );
  const [qty, setQty] = useState(product.minOrderQty);
  const [notice, setNotice] = useState(false);
  const [fav, setFav] = useState(false);
  const [tab, setTab] = useState<Tab>("details");

  const variant: PreviewVariant | undefined = product.variants.find((v) => axes.every((a) => v.values[a.key] === selection[a.key]));

  const optionValues = (axis: SchemaField): FieldValue[] => {
    const seen: FieldValue[] = [];
    for (const v of product.variants) {
      const val = v.values[axis.key];
      if (val !== undefined && !seen.includes(val)) seen.push(val);
    }
    return seen;
  };
  /** A value is reachable if some variant has it together with the OTHER current selections. */
  const reachable = (axis: SchemaField, value: FieldValue) =>
    product.variants.some(
      (v) => v.values[axis.key] === value && axes.every((a) => a.key === axis.key || v.values[a.key] === selection[a.key]),
    );
  const choose = (axis: SchemaField, value: FieldValue) => {
    const next = { ...selection, [axis.key]: value };
    // If the new value makes the combination impossible, move the other axes to the nearest real variant.
    if (!product.variants.some((v) => axes.every((a) => v.values[a.key] === next[a.key]))) {
      const fallback = product.variants.find((v) => v.values[axis.key] === value);
      if (fallback) for (const a of axes) next[a.key] = fallback.values[a.key] as FieldValue;
    }
    setSelection(next);
    setNotice(false);
  };

  const variantInCart = variant ? cart.lines.some((l) => l.variant.id === variant.id) : false;
  const cheapest = Math.min(...product.variants.map((v) => v.priceEgp));
  const showWas = Boolean(product.offer && variant && variant.priceEgp === cheapest);
  const unit = t.units[product.unit];

  // Spec table: product-level values, the sale unit, then the selected variant's own values.
  const specRows: { label: string; value: string }[] = [];
  for (const f of schema) {
    if (f.scope === "product" && product.values[f.key] !== undefined) {
      const text = displayValue(f, product.values[f.key]!, locale, t.yes);
      if (text !== "—") specRows.push({ label: f.name[locale], value: text });
    }
  }
  specRows.push({ label: t.saleUnit, value: unit });
  if (variant) {
    for (const f of schema) {
      if (f.scope === "variant" && f.valueType !== "color" && variant.values[f.key] !== undefined) {
        specRows.push({ label: f.name[locale], value: displayValue(f, variant.values[f.key]!, locale, "") });
      }
    }
  }

  // Highlight strip = real attributes of this product (never invented marketing claims).
  const highlights: { label: string; value: string }[] = [];
  for (const key of ["material", "finish", "pattern", "texture"]) {
    const f = schema.find((x) => x.key === key);
    const v = f ? product.values[key] : undefined;
    if (f && v !== undefined) highlights.push({ label: f.name[locale], value: displayValue(f, v, locale, t.yes) });
  }
  for (const f of schema.filter((x) => x.valueType === "boolean" && product.values[x.key] === true)) {
    highlights.push({ label: f.name[locale], value: t.yes });
  }
  const strip = highlights.slice(0, 4);

  // Length × width in cm, thickness / height in mm (the unit people quote for panels).
  const cm = (mm: number) => (mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1));
  const L = variant?.values.length_mm;
  const W = variant?.values.width_mm;
  const H = variant?.values.thickness_mm;
  const dimsText =
    typeof L === "number" && typeof W === "number"
      ? `${cm(L)} × ${cm(W)} ${locale === "ar" ? "سم" : "cm"}${typeof H === "number" ? ` × ${H} ${locale === "ar" ? "مم" : "mm"}` : ""}`
      : null;

  const related = [
    ...previewProducts.filter((p) => p.id !== product.id && p.type === product.type),
    ...previewProducts.filter((p) => p.id !== product.id && p.type !== product.type),
  ].slice(0, 5);

  const chevron = dir === "rtl" ? "‹" : "›";

  return (
    <article className={styles.page}>
      <nav aria-label={t.breadcrumb}>
        <ol className={styles.crumbs}>
          <li><Link href="/">{t.home}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li><Link href="/marketplace">{t.title}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li><Link href={`/marketplace?type=${product.type}`}>{t.types[product.type]}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li aria-current="page">{product.name[locale]}</li>
        </ol>
      </nav>

      <div className={styles.top}>
        <div className={styles.media}>
          <MarketplaceGallery images={product.images} name={product.name[locale]} locale={locale} dir={dir} />
          {strip.length > 0 ? (
            <ul className={styles.strip}>
              {strip.map((h) => (
                <li key={h.label}>
                  <span className={styles.stripIcon}><CheckIcon size={18} aria-hidden="true" /></span>
                  <span><strong>{h.label}</strong><small>{h.value}</small></span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <section className={styles.buy} aria-labelledby="mp-product-title">
          <div className={styles.buyHead}>
            <span className={styles.seller}>{t.sellerBadge}</span>
            <button type="button" className={styles.fav} aria-pressed={fav} aria-label={t.favorite} onClick={() => setFav((v) => !v)}>
              {fav ? <HeartFilledIcon size={20} /> : <HeartIcon size={20} />}
            </button>
          </div>
          <h1 id="mp-product-title" className={styles.title} data-plain>{product.name[locale]}</h1>
          <div className={styles.metaRow}>
            {variant ? <span>{t.sku}: <bdi dir="ltr">{variant.sku}</bdi></span> : null}
            <span className={styles.rating} aria-label={t.ratingSoon}>
              {[0, 1, 2, 3, 4].map((i) => <StarOutlineIcon key={i} size={14} aria-hidden="true" />)}
              <small>{t.ratingSoon}</small>
            </span>
            {variant ? (
              <span className={variant.stock > 0 ? styles.inStock : styles.outStock}>{variant.stock > 0 ? t.inStock : t.outOfStock}</span>
            ) : null}
          </div>

          {variant ? (
            <p className={styles.price}>
              <strong>{formatPrice(variant.priceEgp, locale)}</strong>
              {showWas && product.offer ? <del>{formatPrice(product.offer.referencePriceEgp, locale)}</del> : null}
              <span>{unit}</span>
            </p>
          ) : null}

          <p className={styles.desc}>{product.description[locale]}</p>

          {axes.map((axis) => (
            <fieldset key={axis.key} className={styles.axis}>
              <legend>{axis.name[locale]}</legend>
              <ul className={axis.valueType === "color" ? styles.swatches : styles.pills}>
                {optionValues(axis).map((value) => {
                  const active = selection[axis.key] === value;
                  const ok = reachable(axis, value);
                  const entry = axis.valueType === "color" ? colorCatalog.find((c) => c.key === value) : undefined;
                  const photo = axis.valueType === "color" ? product.swatchImages?.[String(value)] : undefined;
                  const label = displayValue(axis, value, locale, "");
                  return (
                    <li key={String(value)}>
                      {axis.valueType === "color" ? (
                        <button type="button" aria-pressed={active} aria-label={label} title={label} disabled={!ok && !active}
                          className={`${styles.swatch} ${active ? styles.swatchActive : ""}`} onClick={() => choose(axis, value)}>
                          {photo ? <Image src={photo} alt="" width={56} height={56} /> : <span className={styles.swatchFill} style={{ background: entry?.hex }} />}
                        </button>
                      ) : (
                        <button type="button" aria-pressed={active} disabled={!ok && !active}
                          className={`${styles.pill} ${active ? styles.pillActive : ""}`} onClick={() => choose(axis, value)}>
                          {label}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {axis.valueType === "color" && selection[axis.key] !== undefined ? (
                <p className={styles.axisValue}>{displayValue(axis, selection[axis.key]!, locale, "")}</p>
              ) : null}
            </fieldset>
          ))}

          {dimsText ? (
            <p className={styles.dims}><span>{t.dimensions}</span><span>{dimsText}</span></p>
          ) : null}

          {variant ? (
            <>
              <div className={styles.qtyRow}>
                <span id="mp-qty-label">{t.quantity}</span>
                <div className={styles.stepper} role="group" aria-labelledby="mp-qty-label">
                  <button type="button" aria-label={t.decrease} disabled={qty <= product.minOrderQty}
                    onClick={() => setQty((q) => Math.max(product.minOrderQty, q - product.qtyStep))}>−</button>
                  <input type="number" min={product.minOrderQty} step={product.qtyStep} value={qty} aria-labelledby="mp-qty-label"
                    onChange={(e) => setQty(Math.max(product.minOrderQty, Number(e.target.value) || product.minOrderQty))} />
                  <button type="button" aria-label={t.increase} onClick={() => setQty((q) => q + product.qtyStep)}>+</button>
                </div>
                <span className={styles.minOrder}>{t.minOrder(product.minOrderQty, unit)}</span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={`${styles.addToCart} ${variantInCart ? styles.addToCartOn : ""}`} aria-pressed={variantInCart}
                  disabled={variant.stock <= 0 && !variantInCart}
                  onClick={() => {
                    if (variantInCart) { cart.remove(variant.id); setNotice(false); return; }
                    setNotice(cart.add(product.id, variant.id, qty) === "added");
                  }}>
                  {variantInCart ? <TrashIcon size={18} aria-hidden="true" /> : <ShoppingBagIcon size={18} aria-hidden="true" />}
                  {variantInCart ? t.removeFromCart : t.addToCart}
                </button>
                <button type="button" className={styles.buyNow} disabled aria-disabled="true" title={t.notAvailableYet}>
                  {t.buyNow}<small>{t.soon}</small>
                </button>
              </div>
              <p className={styles.notice} role="status">
                {notice ? <>{t.addedToCart} · <Link href="/marketplace/cart">{t.viewCart}</Link></> : ""}
              </p>
            </>
          ) : (
            <p className={styles.notice} role="status">{t.unavailableCombo}</p>
          )}

          <ul className={styles.guarantees}>
            {t.guarantees.map((g) => <li key={g}>{g}<small>{t.soon}</small></li>)}
          </ul>
        </section>
      </div>

      <section className={styles.tabsWrap}>
        <div className={styles.tabList} role="tablist" aria-label={t.specs}>
          {TABS.map((k) => {
            const soon = SOON_TABS.includes(k);
            return (
              <button key={k} type="button" role="tab" id={`mp-tab-${k}`} aria-selected={tab === k} aria-controls="mp-tabpanel"
                disabled={soon} className={`${styles.tabBtn} ${tab === k ? styles.tabBtnActive : ""}`}
                onClick={() => setTab(k)}>
                {t.tabs[k]}{soon ? <small>{t.soon}</small> : null}
              </button>
            );
          })}
        </div>
        <div id="mp-tabpanel" role="tabpanel" aria-labelledby={`mp-tab-${tab}`} className={styles.panel}>
          {tab === "details" ? (
            <div className={styles.panelGrid}>
              <div className={styles.panelText}>
                <p>{product.description[locale]}</p>
                {product.highlights?.[locale]?.length ? (
                  <ul>{product.highlights[locale].map((h) => <li key={h}>{h}</li>)}</ul>
                ) : null}
              </div>
              <dl className={styles.specTable}>
                {specRows.map((row) => (
                  <div key={row.label} className={styles.specRow}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            </div>
          ) : (
            <dl className={`${styles.specTable} ${styles.specWide}`}>
              {specRows.map((row) => (
                <div key={row.label} className={styles.specRow}><dt>{row.label}</dt><dd>{row.value}</dd></div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {related.length > 0 ? (
        <section className={styles.relatedSection} aria-labelledby="mp-related-title">
          <div className={styles.relatedHead}>
            <h2 id="mp-related-title" data-plain>{t.relatedTitle}</h2>
            <Link href="/marketplace">{t.viewAll}</Link>
          </div>
          <ul className={styles.relatedGrid}>
            {related.map((p) => <li key={p.id}><RelatedCard product={p} locale={locale} /></li>)}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
