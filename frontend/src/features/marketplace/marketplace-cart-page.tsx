"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/controls";
import {
  ChevronLeftIcon, ChevronRightIcon, FileTextIcon, HeartFilledIcon, HeartIcon, HelpIcon, MapPinIcon, PackageIcon,
  ShieldIcon, ShoppingBagIcon, StorefrontIcon, TrashIcon, TruckIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cartCopy, cartPrice } from "./marketplace-cart-copy";
import { clampQty, useMarketplaceCart, type ResolvedLine } from "./marketplace-cart";
import { deliveryFee, sampleDeliveryRates } from "./marketplace-delivery";
import { previewProducts } from "./marketplace-preview-data";
import { colorCatalog } from "./marketplace-schema";
import type { Locale, PreviewProduct } from "./marketplace-types";
import styles from "./marketplace-cart.module.css";

const SELLER = "BestTrade";

function sizeText(line: ResolvedLine, locale: Locale): string | null {
  const cm = (mm: number) => (mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1));
  const { length_mm: L, width_mm: W, thickness_mm: H } = line.variant.values;
  const unit = locale === "ar" ? "سم" : "cm";
  if (typeof L === "number" && typeof W === "number") {
    return `${cm(L)} × ${cm(W)} ${unit}${typeof H === "number" ? ` × ${H} ${locale === "ar" ? "مم" : "mm"}` : ""}`;
  }
  return null;
}

function Suggestion({ product, locale }: { product: PreviewProduct; locale: Locale }) {
  const t = cartCopy[locale];
  const cart = useMarketplaceCart();
  const [fav, setFav] = useState(false);
  const variant = product.variants.filter((v) => v.stock > 0).sort((a, b) => a.priceEgp - b.priceEgp)[0];
  const inCart = cart.hasProduct(product.id);
  return (
    <article className={styles.sugg}>
      <Link href={`/marketplace/products/${product.slug}`} className={styles.suggMedia} aria-label={product.name[locale]}>
        <Image src={product.images[0]!} alt="" fill sizes="(max-width: 767px) 46vw, 15vw" className={styles.cover} />
        {product.offer ? <span className={styles.suggBadge}>{t.offerBadge}</span> : null}
      </Link>
      <button type="button" className={styles.suggFav} aria-pressed={fav} aria-label={locale === "ar" ? "أضف إلى المفضلة" : "Add to favourites"} onClick={() => setFav((v) => !v)}>
        {fav ? <HeartFilledIcon size={16} /> : <HeartIcon size={16} />}
      </button>
      <div className={styles.suggBody}>
        <h3><Link href={`/marketplace/products/${product.slug}`}>{product.name[locale]}</Link></h3>
        <p className={styles.suggSeller}>{SELLER}<StorefrontIcon size={14} aria-hidden="true" /></p>
        <div className={styles.suggFoot}>
          <span className={styles.suggPrice}>
            <strong>{cartPrice(variant?.priceEgp ?? Math.min(...product.variants.map((v) => v.priceEgp)), locale)}</strong>
            {product.offer ? <del>{cartPrice(product.offer.referencePriceEgp, locale)}</del> : null}
          </span>
          <button type="button" className={`${styles.suggCart} ${inCart ? styles.suggCartOn : ""}`} disabled={!variant && !inCart} aria-pressed={inCart}
            aria-label={`${inCart ? t.removeFromCart : t.addToCart}: ${product.name[locale]}`}
            onClick={() => { if (inCart) cart.removeProduct(product.id); else if (variant) cart.add(product.id, variant.id); }}>
            {inCart ? <TrashIcon size={16} aria-hidden="true" /> : <ShoppingBagIcon size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </article>
  );
}

/** A horizontally scrollable row of product cards with a title, "view all" link and prev/next arrows. */
function Shelf({ id, title, products, href, locale, dir }: { id: string; title: string; products: PreviewProduct[]; href: string; locale: Locale; dir: "rtl" | "ltr" }) {
  const t = cartCopy[locale];
  const track = useRef<HTMLUListElement>(null);
  if (products.length === 0) return null;
  const scrollTrack = (visual: "left" | "right") => {
    const el = track.current;
    if (el) el.scrollBy({ left: (visual === "left" ? -1 : 1) * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <section className={styles.also} aria-labelledby={id}>
      <div className={styles.alsoHead}>
        <h2 id={id} data-plain>{title}</h2>
        <div className={styles.alsoTools}>
          <Link href={href}>{t.viewAll}</Link>
          <button type="button" aria-label={t.prev} onClick={() => scrollTrack(dir === "rtl" ? "right" : "left")}><ChevronLeftIcon size={18} aria-hidden="true" /></button>
          <button type="button" aria-label={t.next} onClick={() => scrollTrack(dir === "rtl" ? "left" : "right")}><ChevronRightIcon size={18} aria-hidden="true" /></button>
        </div>
      </div>
      <ul ref={track} className={styles.track}>
        {products.map((p) => <li key={p.id}><Suggestion product={p} locale={locale} /></li>)}
      </ul>
    </section>
  );
}

export function MarketplaceCartPage() {
  const { locale, dir } = useI18n();
  const t = cartCopy[locale];
  const cart = useMarketplaceCart();
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [gov, setGov] = useState("cairo");
  const [area, setArea] = useState("nasr_city");
  const [address, setAddress] = useState("");
  const [placed, setPlaced] = useState(false);

  const governorate = sampleDeliveryRates.find((g) => g.key === gov);
  const fee = method === "delivery" ? deliveryFee(gov, area) : 0;
  const deliveryAvailable = method === "pickup" || fee !== null;
  const total = cart.subtotalEgp + (fee ?? 0);

  const suggestions = useMemo(() => {
    const inCart = new Set(cart.lines.map((l) => l.product.id));
    return previewProducts.filter((p) => !inCart.has(p.id)).slice(0, 8);
  }, [cart.lines]);

  const bestSellers = useMemo(
    () => [...previewProducts].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0)).slice(0, 8),
    [],
  );
  const deals = useMemo(() => previewProducts.filter((p) => p.offer), []);

  const chevron = dir === "rtl" ? "‹" : "›";
  const empty = cart.ready && cart.lines.length === 0;

  return (
    <div className={styles.page}>
      <nav aria-label={t.breadcrumbCart}>
        <ol className={styles.crumbs}>
          <li><Link href="/">{locale === "ar" ? "الرئيسية" : "Home"}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li aria-current="page">{t.breadcrumbCart}</li>
        </ol>
      </nav>

      <header className={styles.head}>
        <ShoppingBagIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </header>

      {empty ? (
        <>
          <section className={styles.empty}>
            <h2 data-plain>{t.emptyTitle}</h2>
            <p>{t.emptyText}</p>
            <Link href="/marketplace" className={styles.primary}>{t.continueShopping}</Link>
          </section>
          <Shelf id="cart-best-title" title={t.bestSellers} products={bestSellers} href="/marketplace?sort=best_selling" locale={locale} dir={dir} />
          <Shelf id="cart-offers-title" title={t.offers} products={deals} href="/marketplace?offer=regular,flash" locale={locale} dir={dir} />
        </>
      ) : (
        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.card} aria-labelledby="cart-items-title">
              <h2 id="cart-items-title" className={styles.cardTitle} data-plain><ShoppingBagIcon size={20} aria-hidden="true" />{t.itemsTitle(cart.lines.length)}</h2>
              <div className={styles.tableHead} aria-hidden="true">
                <span>{t.colProduct}</span><span>{t.colUnitPrice}</span><span>{t.colQty}</span><span>{t.colTotal}</span><span />
              </div>
              <ul className={styles.lines}>
                {cart.lines.map((line) => {
                  const name = line.product.name[locale];
                  const color = colorCatalog.find((c) => c.key === line.variant.values.color);
                  const size = sizeText(line, locale);
                  const step = line.product.qtyStep || 1;
                  const min = line.product.minOrderQty || 1;
                  return (
                    <li key={line.variant.id} className={styles.line}>
                      <div className={styles.product}>
                        <Link href={`/marketplace/products/${line.product.slug}`} className={styles.thumb}>
                          <Image src={line.product.images[0]!} alt="" fill sizes="120px" className={styles.cover} />
                        </Link>
                        <div className={styles.info}>
                          <h3><Link href={`/marketplace/products/${line.product.slug}`}>{name}</Link></h3>
                          <p className={styles.muted}>{SELLER}<StorefrontIcon size={14} aria-hidden="true" /></p>
                          <p className={styles.muted}>{t.sku}: <bdi dir="ltr">{line.variant.sku}</bdi></p>
                          {color ? (
                            <p className={styles.attr}>
                              {t.color}: <span className={styles.dot} style={{ background: color.hex }} aria-hidden="true" />{color.name[locale]}
                            </p>
                          ) : null}
                          {size ? <p className={styles.attr}>{t.size}: <span>{size}</span></p> : null}
                        </div>
                      </div>
                      <div className={styles.cell} data-label={t.colUnitPrice}>
                        <span className={styles.price}>{cartPrice(line.variant.priceEgp, locale)}</span>
                      </div>
                      <div className={styles.cell} data-label={t.colQty}>
                        <div className={styles.stepper} role="group" aria-label={`${t.qty}: ${name}`}>
                          <button type="button" aria-label={t.decrease} disabled={line.qty <= min}
                            onClick={() => cart.setQty(line.variant.id, line.qty - step)}>−</button>
                          <input type="number" min={min} step={step} max={Math.max(line.variant.stock, min)} value={line.qty} aria-label={`${t.qty}: ${name}`}
                            onChange={(e) => cart.setQty(line.variant.id, clampQty(line.product, line.variant, Number(e.target.value) || min))} />
                          <button type="button" aria-label={t.increase} disabled={line.qty >= line.variant.stock}
                            onClick={() => cart.setQty(line.variant.id, line.qty + step)}>+</button>
                        </div>
                      </div>
                      <div className={styles.cell} data-label={t.colTotal}>
                        <span className={`${styles.price} ${styles.lineTotal}`}>{cartPrice(line.lineTotalEgp, locale)}</span>
                      </div>
                      <div className={styles.cell}>
                        <button type="button" className={styles.trash} aria-label={t.remove(name)} onClick={() => cart.remove(line.variant.id)}>
                          <TrashIcon size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <ul className={styles.perks}>
              {[TruckIcon, PackageIcon, ShieldIcon, HelpIcon].map((Icon, i) => (
                <li key={i}>
                  <Icon size={30} aria-hidden="true" />
                  <span><strong>{t.perks[i]![0]}</strong><small>{t.perks[i]![1]}</small></span>
                </li>
              ))}
            </ul>

            <Shelf id="cart-also-title" title={t.alsoLike} products={suggestions} href="/marketplace" locale={locale} dir={dir} />
          </div>

          <aside className={styles.side} aria-label={t.summary}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} data-plain><FileTextIcon size={20} aria-hidden="true" />{t.summary}</h2>
              <dl className={styles.totals}>
                <div><dt>{t.itemsTotal(cart.lines.length)}</dt><dd>{cartPrice(cart.subtotalEgp, locale)}</dd></div>
                <div>
                  <dt>{t.deliveryFee}</dt>
                  <dd>
                    {method === "pickup" ? t.free : fee !== null ? cartPrice(fee, locale) : "—"}
                  </dd>
                </div>
              </dl>
              <div className={styles.grand}>
                <div><strong>{t.orderTotal}</strong><small>{t.orderTotalNote}</small></div>
                <strong className={styles.grandValue}>{cartPrice(total, locale)}</strong>
              </div>
            </section>

            <section className={styles.card}>
              <h2 className={styles.cardTitle} data-plain><TruckIcon size={20} aria-hidden="true" />{t.method}</h2>
              <div className={styles.methods} role="radiogroup" aria-label={t.method}>
                <label className={`${styles.method} ${method === "delivery" ? styles.methodOn : ""}`}>
                  <input type="radio" name="mp-method" checked={method === "delivery"} onChange={() => setMethod("delivery")} />
                  <span className={styles.methodText}><strong>{t.delivery}</strong><small>{t.deliveryDesc}</small></span>
                  <TruckIcon size={30} aria-hidden="true" />
                </label>
                <label className={`${styles.method} ${method === "pickup" ? styles.methodOn : ""}`}>
                  <input type="radio" name="mp-method" checked={method === "pickup"} onChange={() => setMethod("pickup")} />
                  <span className={styles.methodText}><strong>{t.pickup}</strong><small>{t.pickupDesc}</small></span>
                  <StorefrontIcon size={30} aria-hidden="true" />
                </label>
              </div>

              {method === "delivery" ? (
                <div className={styles.details}>
                  <h3><MapPinIcon size={18} aria-hidden="true" />{t.deliveryDetails}</h3>
                  <div className={styles.twoCols}>
                    <label className={styles.field}>
                      <span>{t.governorate}</span>
                      <Select id="mp-gov" value={gov} onChange={(e) => {
                        const next = e.target.value;
                        setGov(next);
                        setArea(sampleDeliveryRates.find((g) => g.key === next)?.areas[0]?.key ?? "");
                      }}>
                        {sampleDeliveryRates.map((g) => <option key={g.key} value={g.key}>{g.name[locale]}</option>)}
                      </Select>
                    </label>
                    <label className={styles.field}>
                      <span>{t.area}</span>
                      <Select id="mp-area" value={area} onChange={(e) => setArea(e.target.value)}>
                        {(governorate?.areas ?? []).map((a) => <option key={a.key} value={a.key}>{a.name[locale]}</option>)}
                      </Select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>{t.address}</span>
                    <textarea rows={2} value={address} placeholder={t.addressPlaceholder} onChange={(e) => setAddress(e.target.value)} />
                  </label>
                  <p className={styles.feeRow}>
                    <span>{t.deliveryFee}</span>
                    <strong>{fee !== null ? cartPrice(fee, locale) : "—"}</strong>
                  </p>
                  {fee === null ? <p className={styles.warn} role="status">{area ? t.notAvailable : t.needArea}</p> : <p className={styles.hint}>{t.deliveryFeeHint}</p>}
                </div>
              ) : null}
            </section>

            <div className={styles.actions}>
              <button type="button" className={styles.checkout} disabled={!deliveryAvailable || cart.lines.length === 0} onClick={() => setPlaced(true)}>
                <ShieldIcon size={18} aria-hidden="true" />{t.checkout}
              </button>
              <p className={styles.hint} role="status">{placed ? t.checkoutNext : ""}</p>
              <Link href="/marketplace" className={styles.secondary}>
                {dir === "rtl" ? <ChevronRightIcon size={18} aria-hidden="true" /> : <ChevronLeftIcon size={18} aria-hidden="true" />}
                {t.continueShopping}
              </Link>
            </div>
            <p className={styles.previewNote}>{t.previewNote}</p>
          </aside>
        </div>
      )}
    </div>
  );
}
