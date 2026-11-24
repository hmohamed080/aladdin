"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/controls";
import { MapPinIcon, MoneyIcon, ReceiptIcon, ShieldIcon, StorefrontIcon, TruckIcon, UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES, MARKETPLACE_IMAGE_MAX_BYTES } from "@/lib/storage/marketplace-images";
import { confirmCheckoutAction, confirmReceiptAction, prepareCheckoutAction, removeReceiptAction, requestReceiptUploadAction } from "@/server/actions/marketplace-checkout";
import { useLiveCart } from "@/features/marketplace/live/live-cart-store";
import { fmtEgp } from "@/features/marketplace/live/live-copy";
import type { SavedAddress } from "@/features/marketplace-addresses/address-model";
import { areaName, governorateName } from "@/features/marketplace-seller/place-label";
import styles from "@/features/marketplace/marketplace-cart.module.css";
import { checkoutCopy, checkoutError } from "./checkout-copy";
import {
  canConfirm,
  idempotencyKeyFor,
  isMissingCode,
  needsReceipt,
  offeredPayments,
  type CheckoutFulfilment,
  type CheckoutPayment,
  type CheckoutPrepared,
  type CheckoutSpeed,
} from "./checkout-model";

/**
 * Checkout v2 (signed-in buyers). One showroom per order: the buyer picks delivery (a saved address and a speed) or branch
 * pickup, then COD / InstaPay in full / InstaPay deposit. Every price comes from `marketplace_checkout_prepare`; an InstaPay
 * receipt is uploaded to the checkout session BEFORE the order can be confirmed; the confirm call is idempotent (one key per
 * session), so a double press can never place two orders.
 */
export function CheckoutPage({ addresses, userName }: { addresses: SavedAddress[]; userName: string }) {
  const { locale, dir } = useI18n();
  const c = checkoutCopy[locale];
  const router = useRouter();
  const cart = useLiveCart();
  const [fulfilment, setFulfilment] = useState<CheckoutFulfilment>("delivery");
  const [speed, setSpeed] = useState<CheckoutSpeed>("standard");
  const [payment, setPayment] = useState<CheckoutPayment>("cod");
  const [addressId, setAddressId] = useState<string>(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? "");
  const [prepared, setPrepared] = useState<CheckoutPrepared | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"upload" | "confirm" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const linesJson = JSON.stringify(cart.lines.map((l) => ({ slug: l.slug, sku: l.sku, qty: l.qty })));
  const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : fmtEgp(Number(n), locale));
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(new Date(iso));

  const prepare = useCallback(async () => {
    const lines = JSON.parse(linesJson) as { slug: string; sku: string; qty: number }[];
    if (lines.length === 0) return;
    setState("loading");
    const r = await prepareCheckoutAction({
      lines,
      fulfilment,
      addressId: fulfilment === "delivery" && addressId ? addressId : null,
      speed: fulfilment === "delivery" ? speed : "standard",
      payment,
      sessionId: sessionRef.current,
    });
    if (!r.ok) {
      setProblem(checkoutError(locale, r.code));
      setState("failed");
      // an ended session starts over; anything else keeps the current one
      if (r.code === "session_not_found" || r.code === "session_expired") sessionRef.current = null;
      return;
    }
    sessionRef.current = r.prepared.session_id;
    setPrepared(r.prepared);
    setProblem(null);
    setState("idle");
  }, [linesJson, fulfilment, addressId, speed, payment, locale]);

  useEffect(() => {
    if (!cart.ready) return;
    void prepare();
    // `attempt` re-runs the preparation after a retry
  }, [cart.ready, prepare, attempt]);

  const quote = prepared?.quote ?? null;
  const offered = useMemo(() => (quote ? offeredPayments(quote) : []), [quote]);
  useEffect(() => {
    if (offered.length > 0 && !offered.includes(payment)) setPayment(offered[0]!);
  }, [offered, payment]);

  const upload = async (f: File | undefined) => {
    if (!f || !prepared) return;
    setProblem(null);
    if (!(MARKETPLACE_IMAGE_ALLOWED_TYPES as readonly string[]).includes(f.type)) return setProblem(checkoutError(locale, "image_type_invalid"));
    if (f.size > MARKETPLACE_IMAGE_MAX_BYTES) return setProblem(checkoutError(locale, "file_too_large"));
    setBusy("upload");
    try {
      const ticket = await requestReceiptUploadAction(prepared.session_id, f.type, f.size);
      if (!ticket.ok) return setProblem(checkoutError(locale, ticket.code));
      try {
        await uploadWithGrant(ticket.grant, f);
      } catch {
        return setProblem(checkoutError(locale, "upload_failed"));
      }
      const done = await confirmReceiptAction(ticket.proofId, ticket.objectKey);
      if (!done.ok) return setProblem(checkoutError(locale, done.code));
      await prepare();
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  const removeReceipt = async () => {
    const first = prepared?.receipts?.[0];
    if (!first) return;
    const r = await removeReceiptAction(first.id);
    if (!r.ok) return setProblem(checkoutError(locale, r.code));
    await prepare();
  };

  const confirm = async () => {
    if (!prepared || !canConfirm(prepared)) return;
    setBusy("confirm");
    setProblem(null);
    try {
      const r = await confirmCheckoutAction(prepared.session_id, prepared.quote_hash, idempotencyKeyFor(prepared.session_id), note);
      if (!r.ok) {
        setProblem(checkoutError(locale, r.code));
        // the price or stock changed: show the new summary, the buyer confirms again
        if (r.code === "quote_changed" || r.code === "cart_changed" || r.code === "insufficient_stock") await prepare();
        return;
      }
      cart.clear();
      router.push(`/market/checkout/confirmed/${r.confirmed.orders[0]?.id ?? ""}`);
    } catch {
      setProblem(checkoutError(locale, "unexpected"));
    } finally {
      setBusy(null);
    }
  };

  const chevron = dir === "rtl" ? "‹" : "›";
  const crumbs = (
    <nav aria-label={c.title}>
      <ol className={styles.crumbs}>
        <li><Link href="/market">{locale === "ar" ? "السوق" : "Marketplace"}</Link></li>
        <li aria-hidden="true">{chevron}</li>
        <li><Link href="/market/cart">{locale === "ar" ? "السلة" : "Cart"}</Link></li>
        <li aria-hidden="true">{chevron}</li>
        <li aria-current="page">{c.title}</li>
      </ol>
    </nav>
  );

  if (cart.ready && cart.lines.length === 0) {
    return (
      <div className={styles.page}>
        {crumbs}
        <section className={styles.empty}>
          <p>{c.empty}</p>
          <Link href="/market" className={styles.primary}>{c.continueShopping}</Link>
        </section>
      </div>
    );
  }

  const addressLabel = (a: SavedAddress) =>
    [a.nickname ?? "", governorateName(a.governorate_key, locale), areaName(a.governorate_key, a.area_key, locale), a.street ?? ""].filter(Boolean).join(" — ");
  const receiptCount = prepared?.receipts?.length ?? 0;
  const payNow = quote?.payment.pay_now_egp ?? 0;

  return (
    <div className={styles.page}>
      {crumbs}
      <header className={styles.head}>
        <ShieldIcon size={40} aria-hidden="true" />
        <div>
          <h1 data-plain>{c.title}</h1>
          <p>{userName ? `${userName} — ` : ""}{c.subtitle}</p>
        </div>
      </header>

      {!prepared ? (
        state === "failed" ? (
          <section className={styles.empty}>
            <p role="alert">{problem}</p>
            <button type="button" className={styles.primary} onClick={() => setAttempt((n) => n + 1)}>{c.retry}</button>
            <Link href="/market/cart" className={styles.secondary}>{c.backToCart}</Link>
          </section>
        ) : (
          <p className={styles.hint} role="status">{c.loading}</p>
        )
      ) : quote ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            <section className={styles.card} aria-labelledby="co-recv">
              <h2 id="co-recv" className={styles.cardTitle} data-plain><StorefrontIcon size={20} aria-hidden="true" />{quote.seller.name} — {c.receiving}</h2>
              <div className={styles.methods} role="radiogroup" aria-label={c.receiving}>
                <label className={`${styles.method} ${fulfilment === "delivery" ? styles.methodOn : ""}`}>
                  <input type="radio" name="co-recv" checked={fulfilment === "delivery"} onChange={() => setFulfilment("delivery")} />
                  <span className={styles.methodText}><strong>{c.delivery}</strong></span>
                  <TruckIcon size={30} aria-hidden="true" />
                </label>
                <label className={`${styles.method} ${fulfilment === "pickup" ? styles.methodOn : ""}`}>
                  <input type="radio" name="co-recv" disabled={!quote.seller.pickup_available} checked={fulfilment === "pickup"} onChange={() => setFulfilment("pickup")} />
                  <span className={styles.methodText}><strong>{c.pickup}</strong></span>
                  <StorefrontIcon size={30} aria-hidden="true" />
                </label>
              </div>
              {fulfilment === "delivery" ? (
                <div className={styles.details}>
                  <label className={styles.field}>
                    <span><MapPinIcon size={16} aria-hidden="true" /> {c.address}</span>
                    {addresses.length > 0 ? (
                      <Select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                        {addresses.map((a) => <option key={a.id} value={a.id}>{addressLabel(a)}</option>)}
                      </Select>
                    ) : (
                      <Link href="/settings/addresses" className={styles.secondary}>{c.addAddress}</Link>
                    )}
                  </label>
                  {quote.delivery.next_day ? (
                    <div className={styles.methods} role="radiogroup" aria-label={c.speed}>
                      <label className={`${styles.method} ${speed === "standard" ? styles.methodOn : ""}`}>
                        <input type="radio" name="co-speed" checked={speed === "standard"} onChange={() => setSpeed("standard")} />
                        <span className={styles.methodText}><strong>{c.standard}</strong></span>
                      </label>
                      <label className={`${styles.method} ${speed === "next_day" ? styles.methodOn : ""}`}>
                        <input type="radio" name="co-speed" checked={speed === "next_day"} onChange={() => setSpeed("next_day")} />
                        <span className={styles.methodText}><strong>{c.nextDay(date(quote.delivery.next_day.arrival), money(quote.delivery.next_day.fee_egp))}</strong></span>
                      </label>
                    </div>
                  ) : null}
                  {quote.delivery.estimate ? <p className={styles.hint}>{c.estimate(date(quote.delivery.estimate.earliest), date(quote.delivery.estimate.latest))}</p> : null}
                </div>
              ) : null}
            </section>

            <section className={styles.card} aria-labelledby="co-pay">
              <h2 id="co-pay" className={styles.cardTitle} data-plain><MoneyIcon size={20} aria-hidden="true" />{c.payment}</h2>
              <div className={styles.methods} role="radiogroup" aria-label={c.payment}>
                {offered.includes("cod") ? (
                  <label className={`${styles.method} ${payment === "cod" ? styles.methodOn : ""}`}>
                    <input type="radio" name="co-pay" checked={payment === "cod"} onChange={() => setPayment("cod")} />
                    <span className={styles.methodText}><strong>{c.cod}</strong><small>{c.codDesc}</small></span>
                    <MoneyIcon size={30} aria-hidden="true" />
                  </label>
                ) : null}
                {offered.includes("instapay_full") ? (
                  <label className={`${styles.method} ${payment === "instapay_full" ? styles.methodOn : ""}`}>
                    <input type="radio" name="co-pay" checked={payment === "instapay_full"} onChange={() => setPayment("instapay_full")} />
                    <span className={styles.methodText}><strong>{c.instapayFull}</strong><small>{c.instapayFullDesc}</small></span>
                    <ReceiptIcon size={30} aria-hidden="true" />
                  </label>
                ) : null}
                {quote.payment.methods_enabled.instapay_deposit ? (
                  <label className={`${styles.method} ${payment === "instapay_deposit" ? styles.methodOn : ""}`}>
                    <input type="radio" name="co-pay" checked={payment === "instapay_deposit"} onChange={() => setPayment("instapay_deposit")} />
                    <span className={styles.methodText}>
                      <strong>{c.instapayDeposit(quote.payment.methods_enabled.instapay_deposit.deposit_percent)}</strong>
                      <small>{c.instapayDepositDesc}</small>
                    </span>
                    <ReceiptIcon size={30} aria-hidden="true" />
                  </label>
                ) : null}
                <label className={styles.method} aria-disabled="true">
                  <input type="radio" name="co-pay" disabled />
                  <span className={styles.methodText}><strong>{c.gateway}</strong><small><span className={styles.soon}>{c.soon}</span></small></span>
                  <ShieldIcon size={30} aria-hidden="true" />
                </label>
              </div>

              {needsReceipt(payment) && quote.payment.instapay ? (
                <div className={styles.details} aria-live="polite">
                  <h3 className={styles.feeRow}><span>{c.receiptTitle}</span></h3>
                  <p className={styles.hint}>{c.receiptHelp(quote.payment.instapay.address, quote.payment.instapay.account_name, money(payNow))}</p>
                  <input ref={file} type="file" hidden accept={MARKETPLACE_IMAGE_ALLOWED_TYPES.join(",")} onChange={(e) => void upload(e.target.files?.[0])} />
                  {receiptCount > 0 ? (
                    <p role="status"><ReceiptIcon size={16} aria-hidden="true" /> {c.receiptUploaded} <button type="button" className={styles.secondary} onClick={() => void removeReceipt()}>{c.receiptRemove}</button></p>
                  ) : (
                    <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => file.current?.click()}>
                      <UploadIcon size={16} aria-hidden="true" /> {busy === "upload" ? c.receiptBusy : c.receiptUpload}
                    </button>
                  )}
                </div>
              ) : null}
            </section>

            <section className={styles.card}>
              <label className={styles.field}>
                <span>{c.note}</span>
                <textarea rows={2} maxLength={500} value={note} placeholder={c.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
              </label>
            </section>
          </div>

          <aside className={styles.side} aria-label={c.summary} aria-busy={state === "loading"}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle} data-plain>{c.summary}</h2>
              <ul className={styles.sellerFees}>
                {quote.lines.map((l) => (
                  <li key={`${l.slug}\u0000${l.sku}`}>
                    <span>{locale === "ar" ? l.name_ar || l.name_en : l.name_en || l.name_ar} × {l.quantity}</span>
                    <strong>{money(l.line_total_egp)}</strong>
                  </li>
                ))}
              </ul>
              <dl className={styles.totals}>
                <div><dt>{c.products}</dt><dd>{money(quote.subtotal_egp)}</dd></div>
                <div><dt>{c.deliveryFee}</dt><dd>{quote.delivery.free || quote.delivery_fee_egp === 0 ? c.free : money(quote.delivery_fee_egp)}</dd></div>
                <div><dt><strong>{c.total}</strong></dt><dd><strong>{money(quote.total_egp)}</strong></dd></div>
                {payment !== "cod" ? <div><dt>{c.payNow}</dt><dd>{money(payNow)}</dd></div> : null}
                {payment !== "cod" ? <div><dt>{c.balanceDue}</dt><dd>{money(quote.payment.balance_due_egp)}</dd></div> : null}
              </dl>
              {quote.non_returnable_lines.length > 0 ? (
                <p className={styles.warn} role="note"><strong>{c.nonReturnableTitle}</strong> {c.nonReturnableText(quote.lines.filter((l) => l.non_returnable).map((l) => (locale === "ar" ? l.name_ar : l.name_en)).join("، "))}</p>
              ) : null}
            </section>
            <div className={styles.actions}>
              <button type="button" className={styles.checkout} disabled={!canConfirm(prepared) || busy !== null} aria-busy={busy === "confirm"} onClick={() => void confirm()}>
                <ShieldIcon size={18} aria-hidden="true" />{busy === "confirm" ? c.confirming : c.confirm}
              </button>
              {!canConfirm(prepared) ? (
                <ul className={styles.warn} role="status">
                  {prepared.missing.length === 0 ? <li>{c.notReady}</li> : prepared.missing.map((m) => <li key={m}>{isMissingCode(m) ? c.missing[m] : c.notReady}</li>)}
                </ul>
              ) : null}
              <p className={styles.hint}>{c.holdNote}</p>
              {problem ? <p role="alert" className={styles.warn}>{problem}</p> : null}
              <Link href="/market/cart" className={styles.secondary}>{c.backToCart}</Link>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
