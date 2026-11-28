"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          "timeout-callback"?: () => void;
          theme?: "light" | "dark";
          action?: string;
          appearance?: TurnstileAppearance;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

// Cloudflare's own published, publicly documented always-pass TEST site key,
// pairing with the equally-published always-pass TEST secret that
// server/auth/turnstile.ts uses ONLY when TURNSTILE_SECRET_KEY is unset in
// local dev. Never a real key — see docs/frontend/auth-password-preview.md
// §CAPTCHA.
/**
 * `always`: the visible widget. `interaction-only`: nothing is shown unless
 * Cloudflare needs the person to do something — a real challenge is NEVER
 * assumed to be invisible, it simply appears when required.
 */
export type TurnstileAppearance = "always" | "interaction-only";

const TEST_SITE_KEY = "1x00000000000000000000AA";
/** How long a submission waits for a still-pending challenge before the server is left to answer it. */
export const PENDING_SUBMIT_TIMEOUT_MS = 8_000;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptLoadPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/**
 * Cloudflare Turnstile widget for the two abuse-sensitive public endpoints —
 * Create Account (including its resend-code step) and Forgot Password
 * request. Sign In has NO CAPTCHA.
 *
 * The token is judged by the APP, server-side, via Cloudflare Siteverify
 * (server/auth/turnstile.ts) before Supabase Auth is called. Supabase's
 * global `[auth.captcha]` stays OFF. This component never sees the secret.
 *
 * Renders a hidden input (default `name="captchaToken"`) the surrounding form submits.
 * The token is judged by exactly one party — GoTrue (forwarded as `captchaToken`)
 * or the app's Siteverify (server/auth/captcha.ts) — never both.
 * A Turnstile token is single-use: once the server has spent it on Siteverify,
 * a resubmission after an UNRELATED failure (weak password, invalid email, …)
 * needs a fresh one. The parent form changes `resetKey` (e.g. to the server
 * action's own result object) after every submission, which remounts the
 * widget and requests a new token.
 *
 * A submission made while the challenge is still running (an interaction-only
 * widget mints its token a moment after the form appears, and again after every
 * `resetKey` change) is HELD, not sent without a token: it is replayed with the
 * same submit button as soon as the token arrives. If the challenge errors or no
 * token arrives within PENDING_SUBMIT_TIMEOUT_MS, the submission goes through
 * and the server refuses it with its own CAPTCHA message, exactly as before.
 * Nothing about the server-side check changes.
 */
export function TurnstileWidget({
  resetKey,
  name = "captchaToken",
  action,
  appearance = "always",
}: {
  resetKey?: unknown;
  /** The hidden input's name. A form that needs TWO independent tokens gives each widget its own. */
  name?: string;
  /** Cloudflare `action` (letters, digits, `_`, `-`; max 32). Reported back by Siteverify. */
  action?: string;
  appearance?: TurnstileAppearance;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const failedRef = useRef(false);
  const replayRef = useRef<(() => void) | null>(null);
  const heldSubmitRef = useRef<{ submitter: HTMLElement | null; timer: ReturnType<typeof setTimeout> } | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TEST_SITE_KEY;

  useEffect(() => {
    let cancelled = false;
    setToken("");
    setFailed(false);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          ...(action ? { action } : {}),
          appearance,
          callback: (t) => !cancelled && setToken(t),
          "expired-callback": () => !cancelled && setToken(""),
          "timeout-callback": () => !cancelled && setToken(""),
          "error-callback": () => !cancelled && setFailed(true),
        });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
    // `resetKey` deliberately re-runs this whole effect: the caller changes it
    // after every submission so a spent (single-use) Turnstile token is never
    // reused across an unrelated validation failure.
  }, [siteKey, resetKey, action, appearance]);

  // Hold a submission made before this widget has its token (see above).
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const replay = () => {
      const held = heldSubmitRef.current;
      if (!held) return;
      clearTimeout(held.timer);
      heldSubmitRef.current = null;
      // Replayed with the original submit button, so its name/value are submitted as before.
      const submitter = held.submitter as HTMLButtonElement | HTMLInputElement | null;
      form.requestSubmit(submitter?.form === form ? submitter : undefined);
    };
    const onSubmit = (event: SubmitEvent) => {
      // The committed hidden input is the token this submission would carry.
      if (inputRef.current?.value || failedRef.current) return;
      // Target phase: runs before React's delegated handler, so the action is not dispatched.
      event.preventDefault();
      event.stopPropagation();
      if (heldSubmitRef.current) return;
      heldSubmitRef.current = {
        submitter: event.submitter,
        timer: setTimeout(() => {
          if (!heldSubmitRef.current) return;
          failedRef.current = true;
          replay();
          failedRef.current = false;
        }, PENDING_SUBMIT_TIMEOUT_MS),
      };
    };
    form.addEventListener("submit", onSubmit);
    replayRef.current = replay;
    return () => {
      form.removeEventListener("submit", onSubmit);
      if (heldSubmitRef.current) clearTimeout(heldSubmitRef.current.timer);
      heldSubmitRef.current = null;
      replayRef.current = null;
    };
  }, []);

  // Replay once the token is in the DOM (or the challenge has failed and the server must answer).
  useEffect(() => {
    failedRef.current = failed;
    if ((token || failed) && heldSubmitRef.current) replayRef.current?.();
  }, [token, failed]);

  return (
    <div>
      <div ref={containerRef} />
      <input ref={inputRef} type="hidden" name={name} value={token} data-captcha-ready={token ? "true" : "false"} />
      {failed ? (
        <p role="alert" className="text-label text-danger">
          {t("authPasswordPreview.error.captchaUnavailable")}
        </p>
      ) : null}
      <label htmlFor={inputId} className="sr-only">
        {t("authPasswordPreview.captchaLabel")}
      </label>
    </div>
  );
}
