"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/controls";
import {
  ChevronLeftIcon, ChevronRightIcon, FileTextIcon, HelpIcon, MapPinIcon, PackageIcon,
  ShieldIcon, ShoppingBagIcon, StorefrontIcon, TrashIcon, TruckIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { quoteMarketplaceCartAction } from "@/server/actions/marketplace-cart";
import { cartCopy } from "../marketplace-cart-copy";
import type { Locale } from "../marketplace-types";
import { priceCart, type PricedLine, type ReceivingMethod } from "./cart-math";
import { liveCartCopy } from "./live-cart-copy";
import { useLiveCart } from "./live-cart-store";
import { fmtEgp, fmtNum, liveCopy } from "./live-copy";
import { attributeSwatch, attributeText, labelOf } from "./live-format";
import { CART_MAX_QTY, type CartQuote, type PublicCard } from "./public-contract";
import styles from "../marketplace-cart.module.css";

type QuoteStatus = "idle" | "loading" | "ready" | "failed";

function Suggestion({ card, locale }: { card: PublicCard; locale: Locale }) {
  const t = liveCopy[locale];
  const name = labelOf(card, locale);
  const price = card.from_price_egp;
  return (
    <article className={styles.sugg}>
      <Link href={`/marketplace/products/${card.slug}`} className={styles.suggMedia} aria-label={name}>
        {card.image_id ? (
          // eslint-disable-next-line @next/next/no-img-element -- no-store media proxy
          <img src={`/marketplace/media/${card.image_id}`} alt="" loading="lazy" className={styles.cover} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </Link>
      <div className={styles.suggBody}>
        <h3><Link href={`/marketplace/products/${card.slug}`}>{name}</Link></h3>
        <p className={styles.suggSeller}>{card.seller_name}<StorefrontIcon size={14} aria-hidden="true" /></p>
        <div className={styles.suggFoot}>
          <span className={styles.suggPrice}>
            <strong>{price === null ? "—" : fmtEgp(Number(price), locale)}</strong>
          </span>
          <Link href={`/marketplace/products/${card.slug}`} className={styles.suggCart} aria-label={`${t.viewProduct}: ${name}`}>
            {locale === "ar" ? <ChevronLeftIcon size={16} aria-hidden="true" /> : <ChevronRightIcon size={16} aria-hidden="true" />}
          </Link>
        </div>
      </div>
    </article>
  );
}

/** A horizontally scrollable row of product cards with a title, "view all" link and prev/next arrows. */
function Shelf({ id, title, cards, locale, dir }: { id: string; title: string; cards: PublicCard[]; locale: Locale; dir: "rtl" | "ltr" }) {
  const t = cartCopy[locale];
  const track = useRef<HTMLUListElement>(null);
  if (cards.length === 0) return null;
  const scrollTrack = (visual: "left" | "right") => {
    const el = track.current;
    if (el) el.scrollBy({ left: (visual === "left" ? -1 : 1) * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <section className={styles.also} aria-labelledby={id}>
      <div className={styles.alsoHead}>
        <h2 id={id} data-plain>{title}</h2>
        <div className={styles.alsoTools}>
          <Link href="/marketplace">{t.viewAll}</Link>
          <button type="button" aria-label={t.prev} onClick={() => scrollTrack(dir === "rtl" ? "right" : "left")}><ChevronLeftIcon size={18} aria-hidden="true" /></button>
          <button type="button" aria-label={t.next} onClick={() => scrollTrack(dir === "rtl" ? "left" : "right")}><ChevronRightIcon size={18} aria-hidden="true" /></button>
        </div>
      </div>
      <ul ref={track} className={styles.track}>
        {cards.map((c) => <li key={c.slug}><Suggestion card={c} locale={locale} /></li>)}
      </ul>
    </section>
  );
}

function LineRow({ line, locale, onQty, onRemove }: {
  line: PricedLine;
  locale: Locale;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const t = cartCopy[locale];
  const l = liveCartCopy[locale];
  const name = locale === "ar" ? line.name_ar || line.name_en : line.name_en || line.name_ar;
  const href = `/marketplace/products/${line.slug}`;
  const max = Math.max(1, line.available);
  return (
    <li className={`${styles.line} ${line.outOfStock ? styles.lineOff : ""}`}>
      <div className={styles.product}>
        <Link href={href} className={styles.thumb} aria-label={name}>
          {line.image_id ? (
            // eslint-disable-next-line @next/next/no-img-element -- no-store media proxy
            <img src={`/marketplace/media/${line.image_id}`} alt="" loading="lazy" className={styles.cover} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
        </Link>
        <div className={styles.info}>
          <h3><Link href={href}>{name}</Link></h3>
          <p className={styles.muted}>{line.brand ?? ""}</p>
          <p className={styles.muted}>{t.sku}: <bdi dir="ltr">{line.sku}</bdi></p>
          {/* what tells variants apart (colour, pattern …) first; long measurement lists stay on the product page */}
          {[...line.attributes].sort((x, y) => Number(attributeSwatch(y) !== null || typeof y.value === "object") - Number(attributeSwatch(x) !== null || typeof x.value === "object")).slice(0, 2).map((a) => {
            const swatch = attributeSwatch(a);
            return (
              <p key={a.key} className={styles.attr}>
                {labelOf(a, locale)}: {swatch ? <span className={styles.dot} style={{ background: swatch }} aria-hidden="true" /> : null}
                <span>{attributeText(a, locale)}</span>
              </p>
            );
          })}
          {line.outOfStock ? <p className={styles.lineNote} role="status">{l.outOfStockLine}</p> : null}
          {!line.outOfStock && line.qty >= line.available && line.available < CART_MAX_QTY ? (
            <p className={styles.lineNote} role="status">{l.onlyAvailable(fmtNum(line.available, locale))}</p>
          ) : null}
        </div>
      </div>
      <div className={styles.cell} data-label={t.colUnitPrice}>
        <span className={styles.price}>{fmtEgp(line.price_egp, locale)}</span>
      </div>
      <div className={styles.cell} data-label={t.colQty}>
        {line.outOfStock ? (
          <span className={styles.muted}>—</span>
        ) : (
          <div className={styles.stepper} role="group" aria-label={`${t.qty}: ${name}`}>
            <button type="button" aria-label={t.decrease} disabled={line.qty <= 1} onClick={() => onQty(line.qty - 1)}>−</button>
            <input type="number" min={1} step={1} max={max} value={line.qty} aria-label={`${t.qty}: ${name}`}
              onChange={(e) => onQty(Number(e.target.value) || 1)} />
            <button type="button" aria-label={t.increase} disabled={line.qty >= max} onClick={() => onQty(line.qty + 1)}>+</button>
          </div>
        )}
      </div>
      <div className={styles.cell} data-label={t.colTotal}>
        <span className={`${styles.price} ${styles.lineTotal}`}>{line.outOfStock ? "—" : fmtEgp(line.lineTotalEgp, locale)}</span>
      </div>
      <div className={styles.cell}>
        <button type="button" className={styles.trash} aria-label={t.remove(name)} onClick={onRemove}>
          <TrashIcon size={18} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * The live guest cart. What is in it (slug + SKU + quantity) comes from this browser; every price,
 * stock level and showroom delivery fee comes from the database through a read-only quote, so the
 * page never shows a number the showrooms did not set. Checkout is not open yet: the button is
 * disabled and says so.
 */
export function LiveCartPage({ suggestions }: { suggestions: PublicCard[] }) {
  const { locale, dir } = useI18n();
  const t = cartCopy[locale];
  const l = liveCartCopy[locale];
  const cart = useLiveCart();
  const { setQty, remove } = cart;

  const [method, setMethod] = useState<ReceivingMethod>("delivery");
  const [gov, setGov] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [status, setStatus] = useState<QuoteStatus>("idle");
  const [attempt, setAttempt] = useState(0);

  // The quote depends on WHICH products are in the cart and WHERE it goes — not on quantities.
  const refsJson = JSON.stringify(cart.lines.map((x) => [x.slug, x.sku]));
  useEffect(() => {
    if (!cart.ready) return;
    const refs = (JSON.parse(refsJson) as [string, string][]).map(([slug, sku]) => ({ slug, sku }));
    if (refs.length === 0) {
      setQuote(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    quoteMarketplaceCartAction(refs, gov || null, area || null)
      .then((q) => {
        if (cancelled) return;
        if (q) {
          setQuote(q);
          setStatus("ready");
        } else setStatus("failed");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [cart.ready, refsJson, gov, area, attempt]);

  const totals = useMemo(() => (quote ? priceCart(quote, cart.lines, method) : null), [quote, cart.lines, method]);

  // A showroom that now has fewer than the cart asked for: bring the stored quantity down to what it can supply.
  useEffect(() => {
    for (const line of totals?.lines ?? []) if (line.reduced) setQty(line.slug, line.sku, line.qty);
  }, [totals, setQty]);

  const cities = gov ? (CITIES_BY_GOVERNORATE[gov] ?? []) : [];
  const inCart = new Set(cart.lines.map((x) => x.slug));
  const cards = suggestions.filter((c) => !inCart.has(c.slug)).slice(0, 8);
  const chevron = dir === "rtl" ? "‹" : "›";
  const empty = cart.ready && cart.lines.length === 0;
  const money = (n: number | null) => (n === null ? "—" : fmtEgp(n, locale));
  const names = (list: { name: string }[]) => list.map((s) => s.name).join(locale === "ar" ? "، " : ", ");
  const itemCount = totals ? totals.lines.length + totals.unavailable.length : cart.lines.length;
  const pricesUnknown = method === "delivery" && totals?.deliveryEgp === null;

  return (
    <div className={styles.page}>
      <nav aria-label={t.breadcrumbCart}>
        <ol className={styles.crumbs}>
          <li><Link href="/">{locale === "ar" ? "الرئيسية" : "Home"}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li><Link href="/marketplace">{liveCopy[locale].back}</Link></li>
          <li aria-hidden="true">{chevron}</li>
          <li aria-current="page">{t.breadcrumbCart}</li>
        </ol>
      </nav>

      <header className={styles.head}>
        <ShoppingBagIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{t.title}</h1>
          <p>{l.subtitle}</p>
        </div>
      </header>

      {empty ? (
        <>
          <section className={styles.empty}>
            <h2 data-plain>{t.emptyTitle}</h2>
            <p>{t.emptyText}</p>
            <Link href="/marketplace" className={styles.primary}>{t.continueShopping}</Link>
          </section>
          <Shelf id="cart-also-title" title={t.alsoLike} cards={cards} locale={locale} dir={dir} />
        </>
      ) : !cart.ready || (status === "loading" && !quote) || (status === "idle" && cart.lines.length > 0) ? (
        <p className={styles.hint} role="status">{l.loading}</p>
      ) : status === "failed" && !quote ? (
        <section className={styles.empty}>
          <p role="alert">{l.quoteFailed}</p>
          <button type="button" className={styles.primary} onClick={() => setAttempt((n) => n + 1)}>{l.retry}</button>
        </section>
      ) : totals ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.card} aria-labelledby="cart-items-title">
              <h2 id="cart-items-title" className={styles.cardTitle} data-plain><ShoppingBagIcon size={20} aria-hidden="true" />{t.itemsTitle(itemCount)}</h2>
              <div className={styles.tableHead} aria-hidden="true">
                <span>{t.colProduct}</span><span>{t.colUnitPrice}</span><span>{t.colQty}</span><span>{t.colTotal}</span><span />
              </div>
              <ul className={styles.lines}>
                {totals.lines.map((line) => (
                  <LineRow
                    key={`${line.slug}\u0000${line.sku}`}
                    line={line}
                    locale={locale}
                    onQty={(qty) => setQty(line.slug, line.sku, qty)}
                    onRemove={() => remove(line.slug, line.sku)}
                  />
                ))}
                {totals.unavailable.map((u) => (
                  <li key={`${u.slug}\u0000${u.sku}`} className={`${styles.line} ${styles.lineOff}`}>
                    <div className={styles.product}>
                      <div className={styles.info}>
                        <h3>{u.sku}</h3>
                        <p className={styles.lineNote} role="status">{l.unavailableLine}</p>
                      </div>
                    </div>
                    <span /><span /><span />
                    <div className={styles.cell}>
                      <button type="button" className={styles.trash} aria-label={t.remove(u.sku)} onClick={() => remove(u.slug, u.sku)}>
                        <TrashIcon size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <ul className={styles.perks}>
              {[TruckIcon, PackageIcon, ShieldIcon, HelpIcon].map((Icon, i) => (
                <li key={i}>
                  <Icon size={30} aria-hidden="true" />
                  <span><strong>{l.perks[i]![0]}</strong><small>{l.perks[i]![1]}</small></span>
                </li>
              ))}
            </ul>

            <Shelf id="cart-also-title" title={t.alsoLike} cards={cards} locale={locale} dir={dir} />
          </div>

          <aside className={styles.side} aria-label={t.summary} aria-busy={status === "loading"}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} data-plain><FileTextIcon size={20} aria-hidden="true" />{t.summary}</h2>
              <dl className={styles.totals}>
                <div><dt>{t.itemsTotal(totals.lines.length)}</dt><dd>{money(totals.productsEgp)}</dd></div>
                <div>
                  <dt>{t.deliveryFee}</dt>
                  <dd>{method === "pickup" ? t.free : money(totals.deliveryEgp)}</dd>
                </div>
              </dl>
              <div className={styles.grand}>
                <div><strong>{t.orderTotal}</strong><small>{t.orderTotalNote}</small></div>
                <strong className={styles.grandValue}>{pricesUnknown ? "—" : money(totals.totalEgp)}</strong>
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
                  <span className={styles.methodText}><strong>{t.pickup}</strong><small>{l.pickupDesc}</small></span>
                  <StorefrontIcon size={30} aria-hidden="true" />
                </label>
              </div>

              {method === "delivery" ? (
                <div className={styles.details}>
                  <h3><MapPinIcon size={18} aria-hidden="true" />{t.deliveryDetails}</h3>
                  <div className={styles.twoCols}>
                    <label className={styles.field}>
                      <span>{t.governorate}</span>
                      <Select id="mp-gov" value={gov} onChange={(e) => { setGov(e.target.value); setArea(""); }}>
                        <option value="">{l.chooseGovernorate}</option>
                        {GOVERNORATE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{locale === "ar" ? g.ar : g.en}</option>)}
                      </Select>
                    </label>
                    <label className={styles.field}>
                      <span>{t.area}</span>
                      <Select id="mp-area" value={area} disabled={!gov} onChange={(e) => setArea(e.target.value)}>
                        <option value="">{l.chooseArea}</option>
                        {cities.map((c) => <option key={c.value} value={c.value}>{locale === "ar" ? c.ar : c.en}</option>)}
                      </Select>
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>{t.address}</span>
                    <textarea rows={2} value={address} placeholder={t.addressPlaceholder} onChange={(e) => setAddress(e.target.value)} />
                  </label>

                  {totals.perSeller.length > 1 ? (
                    <div>
                      <p className={styles.feeRow}><span>{l.deliveryFeeByShowroom}</span></p>
                      <ul className={styles.sellerFees}>
                        {totals.perSeller.map(({ seller, feeEgp }) => (
                          <li key={seller.index}>
                            <span><StorefrontIcon size={14} aria-hidden="true" />{seller.name}</span>
                            <strong>{feeEgp === null ? l.noFee : fmtEgp(feeEgp, locale)}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className={styles.feeRow}>
                    <span>{t.deliveryFee}</span>
                    <strong>{money(totals.deliveryEgp)}</strong>
                  </p>
                  {totals.state === "needs_area" ? <p className={styles.warn} role="status">{t.needArea}</p> : null}
                  {totals.state === "not_available" ? (
                    <p className={styles.warn} role="status">
                      {l.showroomNoDelivery(names(totals.blockedBy))}
                      {gov && !area ? ` — ${l.chooseArea}` : ""}
                    </p>
                  ) : null}
                  {totals.state === "ok" ? <p className={styles.hint}>{t.deliveryFeeHint}</p> : null}
                </div>
              ) : totals.state === "pickup_unavailable" ? (
                <p className={styles.warn} role="status">{l.showroomNoPickup(names(totals.blockedBy))}</p>
              ) : null}
            </section>

            <div className={styles.actions}>
              <button type="button" className={styles.checkout} disabled aria-disabled="true">
                <ShieldIcon size={18} aria-hidden="true" />{l.checkoutSoon}<span className={styles.soon}>{l.soon}</span>
              </button>
              <p className={styles.hint}>{l.checkoutSoonNote}</p>
              <Link href="/marketplace" className={styles.secondary}>
                {dir === "rtl" ? <ChevronRightIcon size={18} aria-hidden="true" /> : <ChevronLeftIcon size={18} aria-hidden="true" />}
                {t.continueShopping}
              </Link>
            </div>
            {status === "failed" ? (
              <p className={styles.warn} role="alert">{l.quoteFailed} <button type="button" className={styles.linkButton} onClick={() => setAttempt((n) => n + 1)}>{l.retry}</button></p>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
