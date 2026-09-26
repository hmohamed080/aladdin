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
          theme?: "light" | "dark";
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
const TEST_SITE_KEY = "1x00000000000000000000AA";
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
 * Renders a hidden `name="captchaToken"` input the surrounding form submits.
 * A Turnstile token is single-use: once the server has spent it on Siteverify,
 * a resubmission after an UNRELATED failure (weak password, invalid email, …)
 * needs a fresh one. The parent form changes `resetKey` (e.g. to the server
 * action's own result object) after every submission, which remounts the
 * widget and requests a new token.
 */
export function TurnstileWidget({ resetKey }: { resetKey?: unknown }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const inputId = useId();

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
          callback: (t) => !cancelled && setToken(t),
          "expired-callback": () => !cancelled && setToken(""),
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
  }, [siteKey, resetKey]);

  return (
    <div>
      <div ref={containerRef} />
      <input type="hidden" name="captchaToken" value={token} />
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
