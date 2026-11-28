"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { liveCartCopy } from "./live-cart-copy";
import styles from "../marketplace-cart.module.css";

/**
 * The sign-in / sign-up dialog of the cart. It does NOT carry its own credentials form: it sends the buyer to the platform's
 * own /auth/sign-in and /auth/sign-up (ADR-0025: one field + password, Turnstile, the mobile WhatsApp code, Google / Facebook),
 * so every account rule and CAPTCHA stays in one place, and `next` brings the buyer back to this same cart. The cart itself
 * waits in the browser and joins the account after sign-in (see ./account-cart).
 */
export const CART_RETURN = "/market/cart";

export function CartSignInModal({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n();
  const c = liveCartCopy[locale];
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const next = encodeURIComponent(CART_RETURN);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className={styles.modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} data-plain>{c.signInTitle}</h2>
        <p>{c.signInText}</p>
        <div className={styles.modalActions}>
          <Link prefetch={false} href={`/auth/sign-in?next=${next}`} className={styles.primary}>{c.signIn}</Link>
          <Link prefetch={false} href={`/auth/sign-up?next=${next}`} className={styles.secondary}>{c.signUp}</Link>
          <button type="button" className={styles.linkButton} onClick={onClose}>{c.continueBrowsing}</button>
        </div>
      </div>
    </div>
  );
}
