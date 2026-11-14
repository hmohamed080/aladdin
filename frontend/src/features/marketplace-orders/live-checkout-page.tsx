"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/controls";
import { FileTextIcon, MapPinIcon, MoneyIcon, ReceiptIcon, ShieldIcon, StorefrontIcon, TruckIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";
import { quoteMarketplaceCartAction } from "@/server/actions/marketplace-cart";
import { placeCheckoutAction } from "@/server/actions/marketplace-orders";
import { useLiveCart } from "@/features/marketplace/live/live-cart-store";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import type { CartQuote } from "@/features/marketplace/live/public-contract";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { buyerCopy, buyerError } from "./buyer-copy";
import { buildCheckout, type SellerChoice } from "./checkout-model";
import { isValidPhone, type PlacedCheckout } from "./contract";

type QuoteStatus = "idle" | "loading" | "ready" | "failed";

/**
 * Checkout of the live Marketplace (signed-in buyers only). One order per showroom: for each, the
 * buyer picks delivery or pickup and one of the payment methods that showroom turned on (cash on
 * delivery, or an InstaPay deposit; online card payment is shown as coming soon). Prices come from
 * the database quote; the place RPC re-prices everything, reserves the stock and is idempotent
 * (the same key is resent if the buyer presses again).
 */
export function LiveCheckoutPage({
  initial,
}: {
  initial: { name: string; phone: string; governorate: string; area: string };
}) {
  const { locale, dir } = useI18n();
  const c = buyerCopy[locale];
  const cart = useLiveCart();

  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [note, setNote] = useState("");
  const [gov, setGov] = useState(initial.governorate);
  const [area, setArea] = useState(initial.area);
  const [address, setAddress] = useState("");
  const [choices, setChoices] = useState<Record<number, SellerChoice>>({});
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [status, setStatus] = useState<QuoteStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PlacedCheckout | null>(null);
  const keyRef = useRef<string | null>(null);

  const refsJson = JSON.stringify(cart.lines.map((x) => [x.slug, x.sku]));
  useEffect(() => {
    if (!cart.ready || placed) return;
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
  }, [cart.ready, refsJson, gov, area, attempt, placed]);

  const view = useMemo(() => (quote ? buildCheckout(quote, cart.lines, choices) : null), [quote, cart.lines, choices]);
  const money = (n: number | null) => (n === null ? "—" : fmtEgp(n, locale));
  const cities = gov ? (CITIES_BY_GOVERNORATE[gov] ?? []) : [];
  const chevron = dir === "rtl" ? "‹" : "›";

  const choose = (index: number, current: SellerChoice, patch: Partial<SellerChoice>) => {
    setProblems([]);
    setChoices((all) => ({ ...all, [index]: { ...current, ...patch } }));
  };

  const place = async () => {
    if (!view) return;
    const found: string[] = [];
    if (name.trim().length < 2) found.push(c.problemName);
    if (!isValidPhone(phone)) found.push(c.problemPhone);
    if (view.needsAddress && (!gov || !area || address.trim().length < 5)) found.push(c.problemAddress);
    for (const s of view.sellers) if (!s.ready) found.push(c.problemChoice(s.seller.name));
    setProblems(found);
    if (found.length > 0 || view.sellers.length === 0) return;
    keyRef.current ??= crypto.randomUUID();
    setPlacing(true);
    try {
      const r = await placeCheckoutAction(
        view.submitLines,
        { name: name.trim(), phone: phone.trim(), note: note.trim(), governorate: gov, area, address: address.trim() },
        view.sellers.map((s) => ({ index: s.submitIndex, fulfilment: s.choice.fulfilment!, payment: s.choice.payment! })),
        keyRef.current,
      );
      if (!r.ok) {
        setProblems([buyerError(locale, r.code)]);
        // a refusal placed nothing: the next press is a new attempt
        keyRef.current = null;
        if (r.code === "cart_changed" || r.code === "insufficient_stock") setAttempt((n) => n + 1);
        return;
      }
      setPlaced(r.checkout);
      cart.clear();
    } catch {
      setProblems([buyerError(locale, "unexpected")]);
    } finally {
      setPlacing(false);
    }
  };

  const crumbs = (
    <nav aria-label={c.checkoutTitle}>
      <ol className={styles.crumbs}>
        <li><Link href="/">{c.home}</Link></li>
        <li aria-hidden="true">{chevron}</li>
        <li><Link href="/marketplace">{c.marketplace}</Link></li>
        <li aria-hidden="true">{chevron}</li>
        <li><Link href="/marketplace/cart">{c.cart}</Link></li>
        <li aria-hidden="true">{chevron}</li>
        <li aria-current="page">{c.checkoutTitle}</li>
      </ol>
    </nav>
  );

  if (placed) {
    return (
      <div className={styles.page}>
        {crumbs}
        <section className={styles.empty} role="status">
          <h2 data-plain>{c.placedTitle}</h2>
          <p>{c.placedText}</p>
          {placed.orders.some((o) => o.payment_method === "instapay") ? <p>{c.placedInstapay}</p> : null}
          <ul className="flex flex-col gap-2">
            {placed.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/marketplace/orders/${o.id}`} className={styles.primary}>{c.viewOrder(o.order_number)}</Link>
              </li>
            ))}
          </ul>
          <Link href="/marketplace/orders" className={styles.secondary}>{c.myOrders}</Link>
        </section>
      </div>
    );
  }

  const empty = cart.ready && cart.lines.length === 0;
  return (
    <div className={styles.page}>
      {crumbs}
      <header className={styles.head}>
        <ShieldIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{c.checkoutTitle}</h1>
          <p>{c.checkoutSubtitle}</p>
        </div>
      </header>

      {empty ? (
        <section className={styles.empty}>
          <p>{c.emptyCart}</p>
          <Link href="/marketplace" className={styles.primary}>{c.continueShopping}</Link>
        </section>
      ) : !cart.ready || (status !== "failed" && !quote) ? (
        <p className={styles.hint} role="status">{c.loading}</p>
      ) : status === "failed" && !quote ? (
        <section className={styles.empty}>
          <p role="alert">{c.quoteFailed}</p>
          <button type="button" className={styles.primary} onClick={() => setAttempt((n) => n + 1)}>{c.retry}</button>
        </section>
      ) : view ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.card} aria-labelledby="co-contact">
              <h2 id="co-contact" className={styles.cardTitle} data-plain><UserIcon size={20} aria-hidden="true" />{c.contactTitle}</h2>
              <div className={styles.details}>
                <div className={styles.twoCols}>
                  <label className={styles.field}>
                    <span>{c.name}</span>
                    <input value={name} maxLength={100} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>{c.phone}</span>
                    <input value={phone} dir="ltr" inputMode="tel" maxLength={20} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
                    <small className={styles.muted}>{c.phoneHint}</small>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>{c.note}</span>
                  <textarea rows={2} maxLength={500} value={note} placeholder={c.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="co-address">
              <h2 id="co-address" className={styles.cardTitle} data-plain><MapPinIcon size={20} aria-hidden="true" />{c.addressTitle}</h2>
              <div className={styles.details}>
                <div className={styles.twoCols}>
                  <label className={styles.field}>
                    <span>{c.governorate}</span>
                    <Select id="co-gov" value={gov} onChange={(e) => { setGov(e.target.value); setArea(""); setProblems([]); }}>
                      <option value="">{c.chooseGovernorate}</option>
                      {GOVERNORATE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{locale === "ar" ? g.ar : g.en}</option>)}
                    </Select>
                  </label>
                  <label className={styles.field}>
                    <span>{c.area}</span>
                    <Select id="co-area" value={area} disabled={!gov} onChange={(e) => { setArea(e.target.value); setProblems([]); }}>
                      <option value="">{c.chooseArea}</option>
                      {cities.map((x) => <option key={x.value} value={x.value}>{locale === "ar" ? x.ar : x.en}</option>)}
                    </Select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>{c.address}</span>
                  <textarea rows={2} maxLength={300} value={address} placeholder={c.addressPlaceholder} onChange={(e) => setAddress(e.target.value)} />
                </label>
              </div>
            </section>

            {view.sellers.map((s) => (
              <section key={s.seller.index} className={styles.card} aria-labelledby={`co-seller-${s.seller.index}`}>
                <h2 id={`co-seller-${s.seller.index}`} className={styles.cardTitle} data-plain>
                  <StorefrontIcon size={20} aria-hidden="true" />{c.showroomTitle(s.seller.name)}
                </h2>
                <ul className={styles.sellerFees}>
                  {s.lines.map((l) => (
                    <li key={`${l.slug}\u0000${l.sku}`}>
                      <span>{(locale === "ar" ? l.name_ar || l.name_en : l.name_en || l.name_ar)} × {l.qty}</span>
                      <strong>{money(l.lineTotalEgp)}</strong>
                    </li>
                  ))}
                </ul>

                <h3 className={styles.feeRow}><span>{c.receiving}</span></h3>
                <div className={styles.methods} role="radiogroup" aria-label={`${c.receiving} — ${s.seller.name}`}>
                  <label className={`${styles.method} ${s.choice.fulfilment === "delivery" ? styles.methodOn : ""}`}>
                    <input type="radio" name={`co-recv-${s.seller.index}`} disabled={!s.canDeliver}
                      checked={s.choice.fulfilment === "delivery"} onChange={() => choose(s.seller.index, s.choice, { fulfilment: "delivery" })} />
                    <span className={styles.methodText}>
                      <strong>{c.delivery}</strong>
                      <small>
                        {s.seller.delivery.status === "available" ? c.deliveryFee(money(s.seller.delivery.fee_egp))
                          : s.seller.delivery.status === "needs_area" ? c.deliveryNeedsArea : c.deliveryNotHere}
                      </small>
                    </span>
                    <TruckIcon size={30} aria-hidden="true" />
                  </label>
                  <label className={`${styles.method} ${s.choice.fulfilment === "pickup" ? styles.methodOn : ""}`}>
                    <input type="radio" name={`co-recv-${s.seller.index}`} disabled={!s.canPickup}
                      checked={s.choice.fulfilment === "pickup"} onChange={() => choose(s.seller.index, s.choice, { fulfilment: "pickup" })} />
                    <span className={styles.methodText}><strong>{c.pickup}</strong><small>{s.canPickup ? c.pickupFree : c.pickupNotOffered}</small></span>
                    <StorefrontIcon size={30} aria-hidden="true" />
                  </label>
                </div>

                <h3 className={styles.feeRow}><span>{c.payment}</span></h3>
                {!s.cod && s.instapayPercent === null ? <p className={styles.warn} role="status">{c.noPayment}</p> : null}
                <div className={styles.methods} role="radiogroup" aria-label={`${c.payment} — ${s.seller.name}`}>
                  {s.cod ? (
                    <label className={`${styles.method} ${s.choice.payment === "cod" ? styles.methodOn : ""}`}>
                      <input type="radio" name={`co-pay-${s.seller.index}`} checked={s.choice.payment === "cod"}
                        onChange={() => choose(s.seller.index, s.choice, { payment: "cod" })} />
                      <span className={styles.methodText}><strong>{c.cod}</strong><small>{c.codDesc}</small></span>
                      <MoneyIcon size={30} aria-hidden="true" />
                    </label>
                  ) : null}
                  {s.instapayPercent !== null ? (
                    <label className={`${styles.method} ${s.choice.payment === "instapay" ? styles.methodOn : ""}`}>
                      <input type="radio" name={`co-pay-${s.seller.index}`} checked={s.choice.payment === "instapay"}
                        onChange={() => choose(s.seller.index, s.choice, { payment: "instapay" })} />
                      <span className={styles.methodText}><strong>{c.instapay}</strong><small>{c.instapayDesc(s.instapayPercent)}</small></span>
                      <ReceiptIcon size={30} aria-hidden="true" />
                    </label>
                  ) : null}
                  <label className={styles.method} aria-disabled="true">
                    <input type="radio" name={`co-pay-${s.seller.index}`} disabled />
                    <span className={styles.methodText}><strong>{c.gateway}</strong><small><span className={styles.soon}>{c.soon}</span></small></span>
                    <ShieldIcon size={30} aria-hidden="true" />
                  </label>
                </div>

                <dl className={styles.totals}>
                  <div><dt>{c.products}</dt><dd>{money(s.subtotalEgp)}</dd></div>
                  <div><dt>{c.deliveryLine}</dt><dd>{money(s.feeEgp)}</dd></div>
                  <div><dt><strong>{c.total}</strong></dt><dd><strong>{money(s.totalEgp)}</strong></dd></div>
                  {s.depositEgp !== null ? <div><dt>{c.depositNow(money(s.depositEgp))}</dt><dd /></div> : null}
                </dl>
              </section>
            ))}
          </div>

          <aside className={styles.side} aria-label={c.grandTotal} aria-busy={status === "loading"}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} data-plain><FileTextIcon size={20} aria-hidden="true" />{c.grandTotal}</h2>
              <div className={styles.grand}>
                <div><strong>{c.grandTotal}</strong><small>{c.exclVat}</small></div>
                <strong className={styles.grandValue}>{money(view.grandTotalEgp)}</strong>
              </div>
              {view.skipped > 0 ? <p className={styles.warn} role="status">{c.unavailableSkipped(view.skipped)}</p> : null}
            </section>
            <div className={styles.actions}>
              <button type="button" className={styles.checkout} disabled={placing || view.sellers.length === 0} aria-busy={placing} onClick={place}>
                <ShieldIcon size={18} aria-hidden="true" />{placing ? c.placing : c.place}
              </button>
              <p className={styles.hint}>{c.reservedNote}</p>
              {problems.length > 0 ? (
                <ul role="alert" className={styles.warn}>
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              ) : null}
              <Link href="/marketplace/cart" className={styles.secondary}>{c.backToCart}</Link>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
